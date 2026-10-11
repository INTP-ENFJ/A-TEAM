-- PRESS-CMS: HR employee editing, account deactivation, HR notifications
-- 1. profiles.is_active column
-- 2. get_hr_employees returns is_active
-- 3. hr_update_employee / hr_set_employee_active RPCs (HR admin only)
-- 4. notifications: new types signup_pending, profile_changed
-- 5. Notify HR admins on new signup requests
-- 6. Notify employees when HR changes their profile (replaces log_profile_hr_changes)

-- 1. Active flag
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- 2. Employee list now includes the active flag
DROP FUNCTION IF EXISTS public.get_hr_employees();

CREATE OR REPLACE FUNCTION public.get_hr_employees()
RETURNS TABLE (
  id UUID,
  name TEXT,
  email TEXT,
  department TEXT,
  department_id UUID,
  rank TEXT,
  role TEXT,
  role_title TEXT,
  position_title_id UUID,
  created_at TIMESTAMPTZ,
  is_active BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '인증되지 않은 사용자입니다.';
  END IF;
  IF NOT public.is_hr_admin(v_uid) THEN
    RAISE EXCEPTION '인사 관리자만 직원 목록을 조회할 수 있습니다.';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.name,
    u.email::TEXT,
    p.department,
    p.department_id,
    p.rank::TEXT,
    p.role::TEXT,
    p.role_title,
    p.position_title_id,
    p.created_at,
    p.is_active
  FROM public.profiles p
  LEFT JOIN auth.users u ON u.id = p.id
  ORDER BY p.is_active DESC, p.name ASC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_hr_employees() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_hr_employees() TO authenticated;

-- 3a. Edit an employee (department, position, rank, role)
CREATE OR REPLACE FUNCTION public.hr_update_employee(
  p_user_id UUID,
  p_department_id UUID,
  p_position_title_id UUID,
  p_rank TEXT,
  p_role TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_dept_name TEXT;
  v_pos_name TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '인증되지 않은 사용자입니다.';
  END IF;
  IF NOT public.is_hr_admin(v_uid) THEN
    RAISE EXCEPTION '인사 관리자만 직원 정보를 수정할 수 있습니다.';
  END IF;
  IF p_user_id = v_uid THEN
    RAISE EXCEPTION '본인 계정은 이 화면에서 수정할 수 없습니다.';
  END IF;

  SELECT d.name INTO v_dept_name
    FROM public.departments d WHERE d.id = p_department_id AND d.is_active = true;
  IF v_dept_name IS NULL THEN
    RAISE EXCEPTION '사용 중인 부서를 선택해 주세요.';
  END IF;

  SELECT t.name INTO v_pos_name
    FROM public.position_titles t WHERE t.id = p_position_title_id AND t.is_active = true;
  IF v_pos_name IS NULL THEN
    RAISE EXCEPTION '사용 중인 직책을 선택해 주세요.';
  END IF;

  UPDATE public.profiles
     SET department_id = p_department_id,
         department = v_dept_name,
         position_title_id = p_position_title_id,
         role_title = v_pos_name,
         rank = p_rank::public.user_rank,
         role = p_role::public.user_role
   WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '대상 직원을 찾을 수 없습니다.';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.hr_update_employee(UUID, UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hr_update_employee(UUID, UUID, UUID, TEXT, TEXT) TO authenticated;

-- 3b. Deactivate / reactivate an account (blocks sign-in, ends sessions)
CREATE OR REPLACE FUNCTION public.hr_set_employee_active(
  p_user_id UUID,
  p_active BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '인증되지 않은 사용자입니다.';
  END IF;
  IF NOT public.is_hr_admin(v_uid) THEN
    RAISE EXCEPTION '인사 관리자만 계정 상태를 바꿀 수 있습니다.';
  END IF;
  IF p_user_id = v_uid THEN
    RAISE EXCEPTION '본인 계정은 비활성화할 수 없습니다.';
  END IF;

  UPDATE public.profiles SET is_active = p_active WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '대상 직원을 찾을 수 없습니다.';
  END IF;

  IF p_active THEN
    UPDATE auth.users SET banned_until = NULL WHERE id = p_user_id;
  ELSE
    UPDATE auth.users
       SET banned_until = timezone('utc'::text, now()) + interval '100 years'
     WHERE id = p_user_id;
    -- End existing sign-ins (best effort)
    BEGIN
      DELETE FROM auth.sessions WHERE user_id = p_user_id;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.hr_set_employee_active(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hr_set_employee_active(UUID, BOOLEAN) TO authenticated;

-- 4. Notification types (replace the CHECK constraint on notifications.type)
DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.notifications'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%type%'
  LOOP
    EXECUTE format('ALTER TABLE public.notifications DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check CHECK (
    type IN (
      'review_requested',
      'changes_requested',
      'review_resubmitted',
      'article_approved',
      'article_published',
      'article_assigned',
      'deadline_changed',
      'feedback_added',
      'signup_pending',
      'profile_changed'
    )
  );

-- 5. New signup request -> notify every HR admin
CREATE OR REPLACE FUNCTION public.notify_signup_requested()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.notifications (recipient_id, actor_id, article_id, type, title, message, is_read, created_at)
  SELECT
    p.id,
    NULL,
    NULL,
    'signup_pending',
    '가입 승인 요청',
    COALESCE(NEW.name, '신규 신청자') || '님이 가입을 신청했습니다. 인사 포털에서 승인해 주세요.',
    false,
    timezone('utc'::text, now())
  FROM public.profiles p
  WHERE p.department = '인사부'
    AND p.can_manage_signups = true
    AND p.is_active = true;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_signup_requested ON public.signup_requests;
CREATE TRIGGER trg_notify_signup_requested
  AFTER INSERT ON public.signup_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_signup_requested();

-- 6. Profile change log + notify the employee (replaces the version from 20261008210000)
CREATE OR REPLACE FUNCTION public.log_profile_hr_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_old JSONB := to_jsonb(OLD);
  v_new JSONB := to_jsonb(NEW);
  v_key TEXT;
  v_changes JSONB := '{}'::jsonb;
  v_lines TEXT[] := ARRAY[]::TEXT[];
  v_label TEXT;
  v_from TEXT;
  v_to TEXT;
  v_actor UUID := auth.uid();
BEGIN
  FOREACH v_key IN ARRAY ARRAY[
    'name', 'department', 'department_id', 'position_title_id',
    'role', 'rank', 'role_title', 'can_manage_signups', 'is_active'
  ]
  LOOP
    IF v_old ? v_key AND (v_old -> v_key) IS DISTINCT FROM (v_new -> v_key) THEN
      v_from := v_old ->> v_key;
      v_to := v_new ->> v_key;

      IF v_key = 'department_id' THEN
        SELECT name INTO v_from FROM public.departments WHERE id = NULLIF(v_old ->> v_key, '')::uuid;
        SELECT name INTO v_to FROM public.departments WHERE id = NULLIF(v_new ->> v_key, '')::uuid;
      ELSIF v_key = 'position_title_id' THEN
        SELECT name INTO v_from FROM public.position_titles WHERE id = NULLIF(v_old ->> v_key, '')::uuid;
        SELECT name INTO v_to FROM public.position_titles WHERE id = NULLIF(v_new ->> v_key, '')::uuid;
      ELSIF v_key = 'is_active' THEN
        v_from := CASE WHEN v_from = 'true' THEN '사용' ELSE '비활성' END;
        v_to := CASE WHEN v_to = 'true' THEN '사용' ELSE '비활성' END;
      END IF;

      v_label := CASE v_key
        WHEN 'name' THEN '이름'
        WHEN 'department' THEN '부서'
        WHEN 'department_id' THEN '부서'
        WHEN 'position_title_id' THEN '직책'
        WHEN 'role' THEN '역할'
        WHEN 'rank' THEN '직급'
        WHEN 'role_title' THEN '직함'
        WHEN 'can_manage_signups' THEN '가입 승인 권한'
        WHEN 'is_active' THEN '계정 상태'
        ELSE v_key
      END;

      v_changes := v_changes || jsonb_build_object(v_key, jsonb_build_object('from', v_from, 'to', v_to));
      v_lines := v_lines || (v_label || ': ' || COALESCE(v_from, '없음') || ' → ' || COALESCE(v_to, '없음'));
    END IF;
  END LOOP;

  IF array_length(v_lines, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.hr_audit_logs (actor_id, target_user_id, entity, action, summary, details)
  VALUES (
    v_actor,
    NEW.id,
    'profile',
    'updated',
    COALESCE(NEW.name, '직원') || ' — ' || array_to_string(v_lines, ', '),
    v_changes
  );

  -- Tell the employee when someone else (HR) changed their profile
  IF v_actor IS NOT NULL AND v_actor <> NEW.id THEN
    INSERT INTO public.notifications (recipient_id, actor_id, article_id, type, title, message, is_read, created_at)
    VALUES (
      NEW.id,
      v_actor,
      NULL,
      'profile_changed',
      '인사 정보 변경',
      '인사 담당자가 내 정보를 변경했습니다. ' || array_to_string(v_lines, ', '),
      false,
      timezone('utc'::text, now())
    );
  END IF;

  RETURN NEW;
END;
$$;
