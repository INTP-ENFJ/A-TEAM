-- ========================================================
-- PRESS-CMS: 인사 관리자 전용 전체 직원 조회 RPC 마이그레이션
-- ========================================================

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
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  -- 1. 인증 검증
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '인증되지 않은 사용자입니다.';
  END IF;

  -- 2. 인사부 관리자 권한 검증 (public.is_hr_admin)
  IF NOT public.is_hr_admin(v_uid) THEN
    RAISE EXCEPTION '인사 관리자만 직원 목록을 조회할 수 있습니다.';
  END IF;

  -- 3. public.profiles (이름 SSOT)와 auth.users (이메일) 결합 조회
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
    p.created_at
  FROM public.profiles p
  LEFT JOIN auth.users u ON u.id = p.id
  ORDER BY p.name ASC;
END;
$$;

-- 권한 통제: PUBLIC 권한 회수 및 authenticated 권한 부여
REVOKE EXECUTE ON FUNCTION public.get_hr_employees() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_hr_employees() TO authenticated;

COMMENT ON FUNCTION public.get_hr_employees() IS '인사부 관리자 전용 직원 명부 조회 RPC (profiles.name 기준 및 auth.users.email 서버측 결합)';
