-- ==============================================================================
-- PRESS-CMS: 비밀번호 분실 신고 테이블 및 인사부 수동 처리 RPC 마이그레이션
-- ==============================================================================
-- 목적:
-- 직원이 비밀번호를 분실했을 때 시스템이 메일을 자동으로 발송하는 대신,
-- 로그인 화면에서 신고를 접수하고 인사관리자가 직접 연락하여 수동 처리할 수 있는 워크플로우를 제공합니다.
-- ==============================================================================

-- 1. 비밀번호 분실 신고 테이블 생성
CREATE TABLE IF NOT EXISTS public.password_reset_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  login_id TEXT NOT NULL,
  company_email TEXT NOT NULL,
  recovery_email TEXT,
  registered_recovery_email TEXT,
  department TEXT NOT NULL DEFAULT '미확인',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'cancelled')),
  resolved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  admin_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.password_reset_requests IS '직원 비밀번호 분실 신고 접수 및 인사부 처리 내역 테이블';

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_pw_reset_status ON public.password_reset_requests(status);
CREATE INDEX IF NOT EXISTS idx_pw_reset_created_at ON public.password_reset_requests(created_at DESC);

-- 2. RLS 활성화
ALTER TABLE public.password_reset_requests ENABLE ROW LEVEL SECURITY;

-- 인사관리자만 전체 조회 가능
DROP POLICY IF EXISTS "HR admins can view password reset requests" ON public.password_reset_requests;
CREATE POLICY "HR admins can view password reset requests" ON public.password_reset_requests
FOR SELECT TO authenticated
USING (public.is_hr_admin(auth.uid()));

-- 인사관리자만 수정(처리 완료) 가능
DROP POLICY IF EXISTS "HR admins can update password reset requests" ON public.password_reset_requests;
CREATE POLICY "HR admins can update password reset requests" ON public.password_reset_requests
FOR UPDATE TO authenticated
USING (public.is_hr_admin(auth.uid()))
WITH CHECK (public.is_hr_admin(auth.uid()));

-- 익명/인증 사용자 모두 INSERT 가능 (보안을 위해 RPC 경유 권장)
DROP POLICY IF EXISTS "Anyone can insert password reset requests" ON public.password_reset_requests;
CREATE POLICY "Anyone can insert password reset requests" ON public.password_reset_requests
FOR INSERT TO anon, authenticated
WITH CHECK (true);

-- 3. 안전한 분실 신고 접수 RPC (비로그인 상태 호출 가능)
CREATE OR REPLACE FUNCTION public.submit_password_reset_request(
  p_name TEXT,
  p_login_id TEXT,
  p_recovery_email TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_norm_id TEXT;
  v_comp_email TEXT;
  v_dept TEXT := '미확인';
  v_registered_rec TEXT := NULL;
  v_req_id UUID;
BEGIN
  -- 1. 입력값 정규화
  v_norm_id := lower(trim(p_login_id));
  -- 도메인이 이미 포함되어 있다면 분리
  IF position('@' in v_norm_id) > 0 THEN
    v_norm_id := split_part(v_norm_id, '@', 1);
  END IF;

  IF length(v_norm_id) = 0 OR length(trim(p_name)) = 0 THEN
    RAISE EXCEPTION '성명과 사내 아이디를 정확히 입력해주세요.';
  END IF;

  v_comp_email := v_norm_id || '@pressdesk.co.kr';

  -- 2. profiles 테이블에서 직원 정보 및 등록된 복구 이메일 확인
  SELECT 
    coalesce(p.department, '미확인'),
    p.recovery_email
  INTO 
    v_dept,
    v_registered_rec
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE lower(u.email) = v_comp_email
     OR (p.name = trim(p_name) AND lower(coalesce(p.recovery_email, '')) = lower(trim(coalesce(p_recovery_email, ''))))
  LIMIT 1;

  -- 3. 분실 신고 레코드 삽입
  INSERT INTO public.password_reset_requests (
    name,
    login_id,
    company_email,
    recovery_email,
    registered_recovery_email,
    department,
    status
  ) VALUES (
    trim(p_name),
    v_norm_id,
    v_comp_email,
    nullif(trim(p_recovery_email), ''),
    v_registered_rec,
    v_dept,
    'pending'
  )
  RETURNING id INTO v_req_id;

  RETURN jsonb_build_object(
    'success', true,
    'request_id', v_req_id,
    'message', '비밀번호 분실 신고가 인사부에 안전하게 접수되었습니다.'
  );
END;
$$;

-- 4. 인사관리자 전용 처리 완료 RPC
CREATE OR REPLACE FUNCTION public.resolve_password_reset_request(
  p_request_id UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller UUID := auth.uid();
BEGIN
  IF NOT public.is_hr_admin(v_caller) THEN
    RAISE EXCEPTION '인사 관리자만 비밀번호 분실 신고를 처리할 수 있습니다.';
  END IF;

  UPDATE public.password_reset_requests
  SET 
    status = 'resolved',
    resolved_by = v_caller,
    resolved_at = now(),
    admin_notes = p_notes,
    updated_at = now()
  WHERE id = p_request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '해당 분실 신고 내역을 찾을 수 없습니다.';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'message', '비밀번호 분실 건이 처리 완료되었습니다.'
  );
END;
$$;

-- 권한 부여
GRANT EXECUTE ON FUNCTION public.submit_password_reset_request(TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_password_reset_request(UUID, TEXT) TO authenticated;
