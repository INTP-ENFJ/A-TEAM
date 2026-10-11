-- ==============================================================================
-- PRESS-CMS: department 공개 범위, 복구 이메일 컬럼, 부서 공유 RLS 정식 마이그레이션
-- ==============================================================================
-- 목적:
-- 1. public.project_visibility enum에 'department' 안전 추가 (이미 존재 시 에러 없이 통과)
-- 2. public.profiles 테이블에 'recovery_email' 컬럼 추가 (비밀번호 복구용 비상 연락 이메일)
-- 3. public.can_access_project, public.can_access_article 함수에 'department' 공개 범위 지원
--    (소속 부서가 일치하는 동료 및 데스크가 정상적으로 열람할 수 있도록 RLS 확장)
-- ==============================================================================

-- 1. project_visibility enum에 'department' 안전 추가
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum 
    WHERE enumtypid = 'public.project_visibility'::regtype 
      AND enumlabel = 'department'
  ) THEN
    ALTER TYPE public.project_visibility ADD VALUE 'department';
  END IF;
END $$;

-- 2. profiles 테이블에 비밀번호 복구 이메일 컬럼 추가
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS recovery_email TEXT;

COMMENT ON COLUMN public.profiles.recovery_email IS '비밀번호 분실 시 복구용 비상 연락 이메일 주소';

-- 3. can_access_project 함수 재정의 ('department' 공개 범위 지원)
CREATE OR REPLACE FUNCTION public.can_access_project(
  p_id UUID, 
  p_owner_id UUID, 
  p_visibility public.project_visibility, 
  p_uid UUID
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT 
    CASE 
      -- 1) 프로젝트 소유자 본인은 항상 열람 가능
      WHEN p_owner_id = p_uid THEN true

      -- 2) 전체 공개('shared') 프로젝트: 초안이 아닌 기사가 있을 때 열람 가능
      WHEN p_visibility = 'shared'::public.project_visibility THEN EXISTS (
        SELECT 1 FROM public.articles 
        WHERE project_id = p_id AND status != 'draft'::public.article_status
      )

      -- 3) 부서 공개('department') 프로젝트: 소속 부서가 일치하는 사용자에게 열람 허용
      WHEN p_visibility = 'department'::public.project_visibility THEN EXISTS (
        SELECT 1 
        FROM public.profiles viewer, public.profiles owner
        WHERE viewer.id = p_uid 
          AND owner.id = p_owner_id
          AND viewer.department IS NOT NULL
          AND viewer.department = owner.department
      )

      ELSE false
    END;
$$;

-- 4. can_access_article 함수 재정의 ('department' 공개 범위 지원)
CREATE OR REPLACE FUNCTION public.can_access_article(
  a_project_id UUID, 
  a_author_id UUID, 
  a_status public.article_status, 
  p_uid UUID
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT 
    CASE 
      -- 1) 기사 작성자 본인
      WHEN a_author_id = p_uid THEN true

      -- 2) 프로젝트 소유자 본인
      WHEN EXISTS (
        SELECT 1 FROM public.projects 
        WHERE id = a_project_id AND owner_id = p_uid
      ) THEN true

      -- 3) 전체 공개('shared') 프로젝트의 기사
      WHEN a_status != 'draft'::public.article_status AND EXISTS (
        SELECT 1 FROM public.projects 
        WHERE id = a_project_id AND visibility = 'shared'::public.project_visibility
      ) THEN true

      -- 4) 부서 공개('department') 프로젝트의 기사 (동일 부서원)
      WHEN a_status != 'draft'::public.article_status AND EXISTS (
        SELECT 1 
        FROM public.projects p
        JOIN public.profiles owner ON owner.id = p.owner_id
        JOIN public.profiles viewer ON viewer.id = p_uid
        WHERE p.id = a_project_id 
          AND p.visibility = 'department'::public.project_visibility
          AND viewer.department IS NOT NULL
          AND viewer.department = owner.department
      ) THEN true

      ELSE false
    END;
$$;

-- 권한 재부여
GRANT EXECUTE ON FUNCTION public.can_access_project(UUID, UUID, public.project_visibility, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_article(UUID, UUID, public.article_status, UUID) TO authenticated;
