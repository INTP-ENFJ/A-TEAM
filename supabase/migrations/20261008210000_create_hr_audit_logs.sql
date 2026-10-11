-- PRESS-CMS: HR / permission change audit log
-- Records who changed which employee profile field, department or position title.
-- Rows are written only by database triggers; HR admins can read them.

CREATE TABLE IF NOT EXISTS public.hr_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  target_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  entity TEXT NOT NULL CHECK (entity IN ('profile', 'department', 'position_title')),
  action TEXT NOT NULL CHECK (action IN ('created', 'updated')),
  summary TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_hr_audit_logs_created ON public.hr_audit_logs (created_at DESC);

ALTER TABLE public.hr_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hr_audit_logs_select_hr" ON public.hr_audit_logs;
CREATE POLICY "hr_audit_logs_select_hr"
  ON public.hr_audit_logs
  FOR SELECT
  TO authenticated
  USING (public.is_hr_admin(auth.uid()));

-- No client INSERT / UPDATE / DELETE policies: only triggers (SECURITY DEFINER) write.

-- Profile changes (only the fields that matter for HR and permissions)
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
        WHEN 'is_active' THEN '계정 사용'
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
    auth.uid(),
    NEW.id,
    'profile',
    'updated',
    COALESCE(NEW.name, '직원') || ' — ' || array_to_string(v_lines, ', '),
    v_changes
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_profile_hr_changes ON public.profiles;
CREATE TRIGGER trg_log_profile_hr_changes
  AFTER UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.log_profile_hr_changes();

-- Department and position title changes
CREATE OR REPLACE FUNCTION public.log_org_master_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_entity TEXT := CASE TG_TABLE_NAME WHEN 'departments' THEN 'department' ELSE 'position_title' END;
  v_label TEXT := CASE TG_TABLE_NAME WHEN 'departments' THEN '부서' ELSE '직책' END;
  v_summary TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_summary := v_label || ' 추가: ' || NEW.name;
    INSERT INTO public.hr_audit_logs (actor_id, entity, action, summary, details)
    VALUES (auth.uid(), v_entity, 'created', v_summary, jsonb_build_object('name', NEW.name));
  ELSE
    IF NEW.name IS DISTINCT FROM OLD.name THEN
      v_summary := v_label || ' 이름 변경: ' || OLD.name || ' → ' || NEW.name;
      INSERT INTO public.hr_audit_logs (actor_id, entity, action, summary, details)
      VALUES (auth.uid(), v_entity, 'updated', v_summary,
              jsonb_build_object('from', OLD.name, 'to', NEW.name));
    END IF;
    IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
      v_summary := v_label || ' ' || NEW.name || ': ' ||
                   CASE WHEN NEW.is_active THEN '사용 재개' ELSE '사용 중지' END;
      INSERT INTO public.hr_audit_logs (actor_id, entity, action, summary, details)
      VALUES (auth.uid(), v_entity, 'updated', v_summary,
              jsonb_build_object('name', NEW.name, 'is_active', NEW.is_active));
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_departments_changes ON public.departments;
CREATE TRIGGER trg_log_departments_changes
  AFTER INSERT OR UPDATE ON public.departments
  FOR EACH ROW EXECUTE FUNCTION public.log_org_master_changes();

DROP TRIGGER IF EXISTS trg_log_position_titles_changes ON public.position_titles;
CREATE TRIGGER trg_log_position_titles_changes
  AFTER INSERT OR UPDATE ON public.position_titles
  FOR EACH ROW EXECUTE FUNCTION public.log_org_master_changes();
