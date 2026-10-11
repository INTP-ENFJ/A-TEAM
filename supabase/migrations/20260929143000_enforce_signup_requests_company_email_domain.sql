-- ==============================================================================
-- PRESS-CMS: signup_requests 회사 이메일 도메인(@pressdesk.co.kr) CHECK constraint 추가
-- ==============================================================================
-- 목적:
-- 가입 신청 테이블(public.signup_requests)에 회사 이메일(@pressdesk.co.kr)만 허용하는
-- 엄격한 DB 무결성 제약조건을 추가하여 프론트엔드 UI 우회 및 비정상 요청을 원천 차단합니다.
--
-- 검증 규칙:
-- 1. email IS NOT NULL
-- 2. 앞뒤 공백 없는 정규화된 형태 (email = trim(email))
-- 3. 유효한 local-part (영문, 숫자, ., _, %, +, -)
-- 4. '@' 정확히 1개
-- 5. 도메인이 정확히 'pressdesk.co.kr' (대소문자 무관)
-- ==============================================================================

ALTER TABLE public.signup_requests
ADD CONSTRAINT check_company_email_domain
CHECK (
  email IS NOT NULL
  AND email = trim(email)
  AND email ~* '^[a-z0-9._%+-]+@pressdesk\.co\.kr$'
);

COMMENT ON CONSTRAINT check_company_email_domain ON public.signup_requests IS 
  'PRESS-CMS 가입 신청 이메일은 반드시 pressdesk.co.kr 회사 계정이어야 합니다.';
