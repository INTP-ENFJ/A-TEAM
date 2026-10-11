-- ==============================================================================
-- PRESS-CMS: profiles recovery_email 컬럼 보장 및 본인 프로필 수정 RLS 정책 보강
-- ==============================================================================

-- 1. profiles 테이블에 recovery_email 컬럼 안전 추가 (존재하지 않을 시)
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS recovery_email TEXT;

COMMENT ON COLUMN public.profiles.recovery_email IS '비밀번호 분실 시 복구용 비상 연락 이메일 주소';

-- 2. profiles 테이블 RLS 활성화 확인
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 3. 본인 프로필 UPDATE RLS 정책 안전 추가 (존재하지 않을 시)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
      AND tablename = 'profiles' 
      AND policyname = 'Users can update own profile'
  ) THEN
    CREATE POLICY "Users can update own profile" ON public.profiles
    FOR UPDATE TO authenticated
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);
  END IF;
END $$;

-- 4. 프로필 전체 조회 SELECT RLS 정책 안전 추가 (동료 기자 및 본인 프로필 조회용)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
      AND tablename = 'profiles' 
      AND policyname = 'Authenticated users can view profiles'
  ) THEN
    CREATE POLICY "Authenticated users can view profiles" ON public.profiles
    FOR SELECT TO authenticated
    USING (true);
  END IF;
END $$;
