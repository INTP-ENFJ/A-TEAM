-- ========================================================
-- PRESS-CMS: 출고 권한 분리, 부장 검토 RLS 및 publish_article RPC
-- ========================================================

-- 1. 기존 helper 함수 anon / PUBLIC EXECUTE 권한 제거
REVOKE EXECUTE ON FUNCTION public.is_hr_admin(UUID) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.can_access_project(UUID, UUID, public.project_visibility, UUID) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.can_access_article(UUID, UUID, public.article_status, UUID) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.can_access_article_block(UUID, UUID) FROM anon, PUBLIC;

GRANT EXECUTE ON FUNCTION public.is_hr_admin(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_project(UUID, UUID, public.project_visibility, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_article(UUID, UUID, public.article_status, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_article_block(UUID, UUID) TO authenticated;

-- 2. can_access_article 갱신 (같은 부서 manager의 ready 기사 SELECT 허용)
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
      -- 1. 기사 작성자 본인
      WHEN a_author_id = p_uid THEN true

      -- 2. 상위 프로젝트 소유자 본인
      WHEN EXISTS (
        SELECT 1 FROM public.projects 
        WHERE id = a_project_id AND owner_id = p_uid
      ) THEN true

      -- 3. 전체 공유된 프로젝트 중 non-draft 기사
      WHEN a_status != 'draft'::public.article_status AND EXISTS (
        SELECT 1 FROM public.projects 
        WHERE id = a_project_id AND visibility = 'shared'::public.project_visibility
      ) THEN true

      -- 4. 같은 부서(department_id) manager의 ready 기사 검토 허용
      WHEN a_status = 'ready'::public.article_status AND EXISTS (
        SELECT 1 
        FROM public.profiles author
        JOIN public.profiles reviewer ON reviewer.id = p_uid
        WHERE author.id = a_author_id
          AND reviewer.rank = 'manager'::public.user_rank
          AND reviewer.department_id IS NOT NULL
          AND author.department_id IS NOT NULL
          AND reviewer.department_id = author.department_id
      ) THEN true

      ELSE false
    END;
$$;

-- 3. can_access_project 갱신 (부장이 검토할 ready 기사가 포함된 프로젝트 SELECT 허용)
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
      -- 1. 프로젝트 소유자 본인
      WHEN p_owner_id = p_uid THEN true

      -- 2. 전체 공유된 프로젝트 중 non-draft 기사가 존재하는 프로젝트
      WHEN p_visibility = 'shared'::public.project_visibility THEN EXISTS (
        SELECT 1 FROM public.articles 
        WHERE project_id = p_id AND status != 'draft'::public.article_status
      )

      -- 3. 같은 부서 manager 검토 대상 ready 기사가 존재하는 프로젝트
      WHEN EXISTS (
        SELECT 1 
        FROM public.articles a
        JOIN public.profiles author ON author.id = a.author_id
        JOIN public.profiles reviewer ON reviewer.id = p_uid
        WHERE a.project_id = p_id
          AND a.status = 'ready'::public.article_status
          AND reviewer.rank = 'manager'::public.user_rank
          AND reviewer.department_id IS NOT NULL
          AND author.department_id IS NOT NULL
          AND reviewer.department_id = author.department_id
      ) THEN true

      ELSE false
    END;
$$;

-- 4. can_access_article_block 연계 확인 (함수 정의 재보장)
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

-- 5. articles 일반 UPDATE 정책 정리 (기존 소유자 편집 모델 유지 및 HR 차단 명시)
DROP POLICY IF EXISTS "Owners can update articles" ON public.articles;
CREATE POLICY "Owners can update articles" ON public.articles
FOR UPDATE TO authenticated
USING (
  NOT public.is_hr_admin(auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.projects 
    WHERE public.projects.id = public.articles.project_id 
      AND public.projects.owner_id = auth.uid()
  )
)
WITH CHECK (
  NOT public.is_hr_admin(auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.projects 
    WHERE public.projects.id = public.articles.project_id 
      AND public.projects.owner_id = auth.uid()
  )
  AND (
    status != 'published'::public.article_status 
    OR EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE public.profiles.id = auth.uid() 
        AND public.profiles.rank = 'manager'::public.user_rank
    )
  )
);

-- 6. public.publish_article RPC 생성 (원자적 출고 전용 트랜잭션 함수)
CREATE OR REPLACE FUNCTION public.publish_article(
  p_article_id UUID,
  p_channels TEXT[]
)
RETURNS public.articles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_reviewer_rank public.user_rank;
  v_reviewer_dept UUID;
  v_author_dept UUID;
  v_current_status public.article_status;
  v_author_id UUID;
  v_updated_article public.articles;
BEGIN
  -- 1. 인증 확인
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '인증되지 않은 사용자입니다.';
  END IF;

  -- 2. HR 관리자 차단
  IF public.is_hr_admin(v_uid) THEN
    RAISE EXCEPTION '인사 관리자는 기사를 출고할 수 없습니다.';
  END IF;

  -- 3. 출고 채널 파라미터 최소 유효성 검증
  IF p_channels IS NULL OR cardinality(p_channels) = 0 THEN
    RAISE EXCEPTION '최소 1개 이상의 출고 채널을 지정해야 합니다.';
  END IF;

  -- 4. 호출자의 직급 및 부서 확인 (반드시 manager 직급이어야 함)
  SELECT rank, department_id INTO v_reviewer_rank, v_reviewer_dept
  FROM public.profiles
  WHERE id = v_uid;

  IF v_reviewer_rank IS NULL OR v_reviewer_rank != 'manager'::public.user_rank THEN
    RAISE EXCEPTION '기사 출고는 부장(manager) 직급만 가능합니다.';
  END IF;

  IF v_reviewer_dept IS NULL THEN
    RAISE EXCEPTION '소속 부서가 설정되지 않은 사용자는 기사를 출고할 수 없습니다.';
  END IF;

  -- 5. 대상 기사 row lock (SELECT ... FOR UPDATE) 및 존재 확인
  SELECT status, author_id 
  INTO v_current_status, v_author_id
  FROM public.articles
  WHERE id = p_article_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '출고 대상 기사를 찾을 수 없습니다.';
  END IF;

  -- 6. 출고 대기(ready) 상태 검증
  IF v_current_status != 'ready'::public.article_status THEN
    RAISE EXCEPTION '출고 대기(ready) 상태의 기사만 출고할 수 있습니다. (현재 상태: %)', v_current_status;
  END IF;

  -- 7. 기사 작성자의 소속 부서 확인
  SELECT department_id INTO v_author_dept
  FROM public.profiles
  WHERE id = v_author_id;

  IF v_author_dept IS NULL THEN
    RAISE EXCEPTION '기사 작성자의 소속 부서 정보가 존재하지 않습니다.';
  END IF;

  -- 8. 동일 부서 소속 검증
  IF v_reviewer_dept != v_author_dept THEN
    RAISE EXCEPTION '동일한 부서 소속 기자의 기사만 출고할 수 있습니다.';
  END IF;

  -- 9. 원자적 UPDATE (동시성 방지를 위해 WHERE status = 'ready' 재확인)
  UPDATE public.articles
  SET 
    status = 'published'::public.article_status,
    publish_destinations = p_channels,
    updated_at = now()
  WHERE id = p_article_id
    AND status = 'ready'::public.article_status
  RETURNING * INTO v_updated_article;

  IF v_updated_article.id IS NULL THEN
    RAISE EXCEPTION '다른 요청에 의해 기사가 이미 출고되었거나 상태가 변경되었습니다.';
  END IF;

  RETURN v_updated_article;
END;
$$;

ALTER FUNCTION public.publish_article(UUID, TEXT[]) OWNER TO postgres;

-- 7. publish_article 실행 권한 설정
REVOKE EXECUTE ON FUNCTION public.publish_article(UUID, TEXT[]) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_article(UUID, TEXT[]) TO authenticated;
