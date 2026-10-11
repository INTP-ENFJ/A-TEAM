-- ========================================================
-- PRESS-CMS: 인사부 조직/직책 마스터 및 뉴스룸 RLS 분리 마이그레이션
-- ========================================================

-- 1. departments 마스터 테이블 생성
CREATE TABLE IF NOT EXISTS public.departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  parent_id UUID REFERENCES public.departments(id) ON DELETE RESTRICT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 최상위 부서 (parent_id IS NULL) 중복 방지 Partial Index
CREATE UNIQUE INDEX IF NOT EXISTS uq_departments_root_name 
ON public.departments (name) WHERE parent_id IS NULL;

-- 하위 부서 (동일 parent_id 내 name) 중복 방지 Partial Index
CREATE UNIQUE INDEX IF NOT EXISTS uq_departments_sub_name 
ON public.departments (parent_id, name) WHERE parent_id IS NOT NULL;

-- 2. position_titles 마스터 테이블 생성
CREATE TABLE IF NOT EXISTS public.position_titles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. profiles / signup_requests에 Nullable FK 추가
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS position_title_id UUID REFERENCES public.position_titles(id) ON DELETE SET NULL;

ALTER TABLE public.signup_requests
ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS assigned_position_title_id UUID REFERENCES public.position_titles(id) ON DELETE SET NULL;

-- 4. 초기 마스터 데이터 시드 (1차 + 2차 계층 구조)
DO $$
DECLARE
  v_econ_id UUID;
  v_soc_id UUID;
  v_cul_id UUID;
  v_photo_id UUID;
  v_digi_id UUID;
  v_hr_id UUID;
BEGIN
  -- 1차 본부/부서
  INSERT INTO public.departments (name, parent_id, sort_order) VALUES ('정치부', NULL, 10) ON CONFLICT DO NOTHING;
  
  INSERT INTO public.departments (name, parent_id, sort_order) VALUES ('경제부', NULL, 20)
    ON CONFLICT (name) WHERE parent_id IS NULL DO NOTHING;
  SELECT id INTO v_econ_id FROM public.departments WHERE name = '경제부' AND parent_id IS NULL;
  IF v_econ_id IS NOT NULL THEN
    INSERT INTO public.departments (name, parent_id, sort_order) VALUES ('산업1부', v_econ_id, 21), ('산업2부', v_econ_id, 22) ON CONFLICT DO NOTHING;
  END IF;

  INSERT INTO public.departments (name, parent_id, sort_order) VALUES ('사회부', NULL, 30)
    ON CONFLICT (name) WHERE parent_id IS NULL DO NOTHING;
  SELECT id INTO v_soc_id FROM public.departments WHERE name = '사회부' AND parent_id IS NULL;
  IF v_soc_id IS NOT NULL THEN
    INSERT INTO public.departments (name, parent_id, sort_order) VALUES ('정책사회부', v_soc_id, 31) ON CONFLICT DO NOTHING;
  END IF;

  INSERT INTO public.departments (name, parent_id, sort_order) VALUES ('국제부', NULL, 40) ON CONFLICT DO NOTHING;

  INSERT INTO public.departments (name, parent_id, sort_order) VALUES ('문화부', NULL, 50)
    ON CONFLICT (name) WHERE parent_id IS NULL DO NOTHING;
  SELECT id INTO v_cul_id FROM public.departments WHERE name = '문화부' AND parent_id IS NULL;
  IF v_cul_id IS NOT NULL THEN
    INSERT INTO public.departments (name, parent_id, sort_order) VALUES ('스포츠부', v_cul_id, 51) ON CONFLICT DO NOTHING;
  END IF;

  INSERT INTO public.departments (name, parent_id, sort_order) VALUES ('사진부', NULL, 60)
    ON CONFLICT (name) WHERE parent_id IS NULL DO NOTHING;
  SELECT id INTO v_photo_id FROM public.departments WHERE name = '사진부' AND parent_id IS NULL;
  IF v_photo_id IS NOT NULL THEN
    INSERT INTO public.departments (name, parent_id, sort_order) VALUES ('편집부', v_photo_id, 61) ON CONFLICT DO NOTHING;
  END IF;

  INSERT INTO public.departments (name, parent_id, sort_order) VALUES ('디지털랩', NULL, 70)
    ON CONFLICT (name) WHERE parent_id IS NULL DO NOTHING;
  SELECT id INTO v_digi_id FROM public.departments WHERE name = '디지털랩' AND parent_id IS NULL;
  IF v_digi_id IS NOT NULL THEN
    INSERT INTO public.departments (name, parent_id, sort_order) VALUES ('디지털뉴스팀', v_digi_id, 71), ('전략영상팀', v_digi_id, 72) ON CONFLICT DO NOTHING;
  END IF;

  INSERT INTO public.departments (name, parent_id, sort_order) VALUES ('인사부', NULL, 80)
    ON CONFLICT (name) WHERE parent_id IS NULL DO NOTHING;
  SELECT id INTO v_hr_id FROM public.departments WHERE name = '인사부' AND parent_id IS NULL;
  IF v_hr_id IS NOT NULL THEN
    INSERT INTO public.departments (name, parent_id, sort_order) VALUES ('관리자용', v_hr_id, 81) ON CONFLICT DO NOTHING;
  END IF;

  -- 5. 초기 직책 데이터 시드
  INSERT INTO public.position_titles (name, sort_order) VALUES 
    ('국장', 10), ('부국장', 20), ('부장', 30), ('차장', 40),
    ('팀장', 50), ('선임기자', 60), ('평기자', 70), ('수습기자', 80)
  ON CONFLICT (name) DO NOTHING;

  -- 6. 기존 데이터 Backfill (부서 및 직책 명칭 기준 매핑)
  UPDATE public.profiles p SET department_id = d.id FROM public.departments d WHERE p.department = d.name AND p.department_id IS NULL;
  UPDATE public.profiles p SET position_title_id = pt.id FROM public.position_titles pt WHERE p.role_title = pt.name AND p.position_title_id IS NULL;
  UPDATE public.signup_requests sr SET department_id = d.id FROM public.departments d WHERE sr.department = d.name AND sr.department_id IS NULL;
END $$;

-- 7. SECURITY DEFINER 권한 검증 헬퍼 함수 4종 생성
CREATE OR REPLACE FUNCTION public.is_hr_admin(p_uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_uid AND department = '인사부' AND can_manage_signups = true
  );
$$;

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
      WHEN p_owner_id = p_uid THEN true
      WHEN p_visibility = 'shared'::public.project_visibility THEN EXISTS (
        SELECT 1 FROM public.articles 
        WHERE project_id = p_id AND status != 'draft'::public.article_status
      )
      ELSE false
    END;
$$;

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
      WHEN a_author_id = p_uid THEN true
      WHEN EXISTS (
        SELECT 1 FROM public.projects 
        WHERE id = a_project_id AND owner_id = p_uid
      ) THEN true
      WHEN a_status != 'draft'::public.article_status AND EXISTS (
        SELECT 1 FROM public.projects 
        WHERE id = a_project_id AND visibility = 'shared'::public.project_visibility
      ) THEN true
      ELSE false
    END;
$$;

CREATE OR REPLACE FUNCTION public.can_access_article_block(
  p_article_id UUID, 
  p_uid UUID
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.articles a
    WHERE a.id = p_article_id
      AND public.can_access_article(a.project_id, a.author_id, a.status, p_uid)
  );
$$;

-- 헬퍼 함수 권한 조정
REVOKE EXECUTE ON FUNCTION public.is_hr_admin(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.can_access_project(UUID, UUID, public.project_visibility, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.can_access_article(UUID, UUID, public.article_status, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.can_access_article_block(UUID, UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.is_hr_admin(UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.can_access_project(UUID, UUID, public.project_visibility, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_article(UUID, UUID, public.article_status, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_article_block(UUID, UUID) TO authenticated;

-- 8. 뉴스룸 데이터 SELECT 정책 교체 (정확히 3개만 교체)
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can read accessible projects" ON public.projects;
CREATE POLICY "Users can read accessible projects" ON public.projects
FOR SELECT TO authenticated
USING (
  NOT public.is_hr_admin(auth.uid())
  AND public.can_access_project(id, owner_id, visibility, auth.uid())
);

ALTER TABLE public.articles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can read accessible articles" ON public.articles;
CREATE POLICY "Users can read accessible articles" ON public.articles
FOR SELECT TO authenticated
USING (
  NOT public.is_hr_admin(auth.uid())
  AND public.can_access_article(project_id, author_id, status, auth.uid())
);

ALTER TABLE public.article_blocks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can read accessible article blocks" ON public.article_blocks;
CREATE POLICY "Users can read accessible article blocks" ON public.article_blocks
FOR SELECT TO authenticated
USING (
  NOT public.is_hr_admin(auth.uid())
  AND public.can_access_article_block(article_id, auth.uid())
);

-- 9. departments / position_titles RLS 정책
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.position_titles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "departments_read_active" ON public.departments;
CREATE POLICY "departments_read_active" ON public.departments
FOR SELECT TO anon, authenticated
USING (is_active = true);

DROP POLICY IF EXISTS "departments_hr_admin_all" ON public.departments;
CREATE POLICY "departments_hr_admin_all" ON public.departments
FOR ALL TO authenticated
USING (public.is_hr_admin(auth.uid()))
WITH CHECK (public.is_hr_admin(auth.uid()));

DROP POLICY IF EXISTS "position_titles_read_active" ON public.position_titles;
CREATE POLICY "position_titles_read_active" ON public.position_titles
FOR SELECT TO authenticated
USING (is_active = true);

DROP POLICY IF EXISTS "position_titles_hr_admin_all" ON public.position_titles;
CREATE POLICY "position_titles_hr_admin_all" ON public.position_titles
FOR ALL TO authenticated
USING (public.is_hr_admin(auth.uid()))
WITH CHECK (public.is_hr_admin(auth.uid()));

-- 10. handle_new_user() 트리거 보강
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (
    id,
    name,
    role,
    rank,
    role_title,
    position_title_id,
    department,
    department_id,
    avatar_url
  )
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'name', '신규 사용자'),
    COALESCE((new.raw_user_meta_data->>'role')::public.user_role, 'reporter'::public.user_role),
    COALESCE((new.raw_user_meta_data->>'rank')::public.user_rank, 'reporter'::public.user_rank),
    new.raw_user_meta_data->>'role_title',
    (new.raw_user_meta_data->>'position_title_id')::uuid,
    COALESCE(new.raw_user_meta_data->>'department', '편집국'),
    (new.raw_user_meta_data->>'department_id')::uuid,
    new.raw_user_meta_data->>'avatar_url'
  );
  RETURN new;
END;
$$;
