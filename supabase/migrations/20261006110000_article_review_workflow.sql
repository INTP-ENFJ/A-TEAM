-- ========================================================
-- PRESS-CMS: Article Review & Approval Workflow Migration
-- ========================================================
-- 실제 뉴스룸 업무 흐름을 반영한 기사 검토·승인 워크플로우 1차 버전을 구현합니다:
-- 1) article_status enum에 'changes_requested'(수정요청) 추가
-- 2) can_access_article / can_access_project 갱신 (데스크 검토 접근성 확장)
-- 3) request_article_review RPC (검토 요청 / 재검토 요청 + 원자적 버전 생성)
-- 4) request_article_changes RPC (데스크 수정 요청 + 데스크 피드백 연계 + 원자적 버전 생성)
-- 5) approve_article RPC (데스크 승인 / 출고대기 전환 + 원자적 버전 생성)
-- 6) publish_article RPC (출고 완료 시 버전 생성 연계 보강)

-- 1. article_status enum 값 추가
ALTER TYPE public.article_status ADD VALUE IF NOT EXISTS 'changes_requested';

-- 2. can_access_article 갱신 (검토중/수정요청/출고대기 상태 기사에 대해 동일 부서 데스크의 SELECT 허용)
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

      -- 4. 같은 부서(department_id) 데스크(부장/차장 또는 데스크에디터/편집국장)의 검토 대상 기사(review, changes_requested, ready) 허용
      WHEN a_status IN ('review'::public.article_status, 'changes_requested'::public.article_status, 'ready'::public.article_status) AND EXISTS (
        SELECT 1 
        FROM public.profiles author
        JOIN public.profiles reviewer ON reviewer.id = p_uid
        WHERE author.id = a_author_id
          AND reviewer.department_id IS NOT NULL
          AND author.department_id IS NOT NULL
          AND reviewer.department_id = author.department_id
          AND (
            reviewer.rank IN ('manager'::public.user_rank, 'deputy'::public.user_rank)
            OR reviewer.role IN ('desk_editor'::public.user_role, 'editor_in_chief'::public.user_role)
          )
      ) THEN true

      ELSE false
    END;
$$;

-- 3. can_access_project 갱신 (데스크 검토 대상 기사가 포함된 프로젝트 SELECT 허용)
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

      -- 3. 같은 부서 데스크 검토 대상 기사(review, changes_requested, ready)가 존재하는 프로젝트
      WHEN EXISTS (
        SELECT 1 
        FROM public.articles a
        JOIN public.profiles author ON author.id = a.author_id
        JOIN public.profiles reviewer ON reviewer.id = p_uid
        WHERE a.project_id = p_id
          AND a.status IN ('review'::public.article_status, 'changes_requested'::public.article_status, 'ready'::public.article_status)
          AND reviewer.department_id IS NOT NULL
          AND author.department_id IS NOT NULL
          AND reviewer.department_id = author.department_id
          AND (
            reviewer.rank IN ('manager'::public.user_rank, 'deputy'::public.user_rank)
            OR reviewer.role IN ('desk_editor'::public.user_role, 'editor_in_chief'::public.user_role)
          )
      ) THEN true

      ELSE false
    END;
$$;

-- 4. RPC: request_article_review
-- 기사 작성자가 기사를 데스크에 검토 요청(draft -> review) 또는 재검토 요청(changes_requested -> review)
CREATE OR REPLACE FUNCTION public.request_article_review(p_article_id UUID)
RETURNS public.articles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_article public.articles;
  v_prev_status public.article_status;
  v_reason TEXT;
  v_updated public.articles;
BEGIN
  -- 1. 인증 확인
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '인증되지 않은 사용자입니다.';
  END IF;

  IF public.is_hr_admin(v_uid) THEN
    RAISE EXCEPTION '인사 관리자는 기사 워크플로우를 처리할 수 없습니다.';
  END IF;

  -- 2. 대상 기사 row lock (SELECT ... FOR UPDATE)
  SELECT * INTO v_article
  FROM public.articles
  WHERE id = p_article_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '대상 기사를 찾을 수 없습니다.';
  END IF;

  -- 3. 작성자 본인 검증
  IF v_article.author_id != v_uid THEN
    RAISE EXCEPTION '기사 작성자 본인만 검토를 요청할 수 있습니다.';
  END IF;

  -- 4. 상태 전이 검증 (draft 또는 changes_requested -> review)
  v_prev_status := v_article.status;
  IF v_prev_status NOT IN ('draft'::public.article_status, 'changes_requested'::public.article_status) THEN
    RAISE EXCEPTION '작성중(draft) 또는 수정요청(changes_requested) 상태의 기사만 검토를 요청할 수 있습니다. (현재 상태: %)', v_prev_status;
  END IF;

  IF v_prev_status = 'draft'::public.article_status THEN
    v_reason := '검토 요청';
  ELSE
    v_reason := '재검토 요청';
  END IF;

  -- 5. 기사 상태를 review로 변경
  UPDATE public.articles
  SET 
    status = 'review'::public.article_status,
    updated_at = timezone('utc'::text, now())
  WHERE id = p_article_id
  RETURNING * INTO v_updated;

  -- 6. 원자적 버전 스냅샷 생성
  PERFORM public.create_article_version(p_article_id, v_reason);

  RETURN v_updated;
END;
$$;

-- 5. RPC: request_article_changes
-- 데스크가 검토중인 기사에 대해 기자에게 수정을 요청 (review -> changes_requested)
CREATE OR REPLACE FUNCTION public.request_article_changes(
  p_article_id UUID,
  p_reason TEXT
)
RETURNS public.articles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_article public.articles;
  v_reviewer RECORD;
  v_author_dept UUID;
  v_trimmed_reason TEXT;
  v_updated public.articles;
  v_author_name TEXT;
BEGIN
  -- 1. 인증 확인
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '인증되지 않은 사용자입니다.';
  END IF;

  IF public.is_hr_admin(v_uid) THEN
    RAISE EXCEPTION '인사 관리자는 기사 수정을 요청할 수 없습니다.';
  END IF;

  v_trimmed_reason := trim(COALESCE(p_reason, ''));
  IF length(v_trimmed_reason) = 0 THEN
    RAISE EXCEPTION '수정 요청 사유를 구체적으로 입력해주세요.';
  END IF;

  -- 2. 검토자 직급 및 부서 확인
  SELECT id, name, rank, role, department_id INTO v_reviewer
  FROM public.profiles
  WHERE id = v_uid;

  IF v_reviewer.id IS NULL THEN
    RAISE EXCEPTION '사용자 프로필을 찾을 수 없습니다.';
  END IF;

  IF NOT (
    v_reviewer.rank IN ('manager'::public.user_rank, 'deputy'::public.user_rank)
    OR v_reviewer.role IN ('desk_editor'::public.user_role, 'editor_in_chief'::public.user_role)
  ) THEN
    RAISE EXCEPTION '기사 수정 요청은 데스크(부장/차장 또는 데스크 에디터)만 가능합니다.';
  END IF;

  -- 3. 대상 기사 row lock
  SELECT * INTO v_article
  FROM public.articles
  WHERE id = p_article_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '대상 기사를 찾을 수 없습니다.';
  END IF;

  -- 4. 본인 기사 자가 수정요청 방지
  IF v_article.author_id = v_uid THEN
    RAISE EXCEPTION '본인의 기사는 직접 수정 요청을 할 수 없습니다.';
  END IF;

  -- 5. 기사 작성자 부서 확인 (동일 부서 검증)
  SELECT department_id, name INTO v_author_dept, v_author_name
  FROM public.profiles
  WHERE id = v_article.author_id;

  IF v_author_dept IS NULL OR v_reviewer.department_id IS NULL OR v_author_dept != v_reviewer.department_id THEN
    RAISE EXCEPTION '동일한 부서 소속 기자의 기사만 수정 요청할 수 있습니다.';
  END IF;

  -- 6. 상태 전이 검증 (review -> changes_requested)
  IF v_article.status != 'review'::public.article_status THEN
    RAISE EXCEPTION '검토중(review) 상태의 기사만 수정을 요청할 수 있습니다. (현재 상태: %)', v_article.status;
  END IF;

  -- 7. 기사 상태를 changes_requested로 변경
  UPDATE public.articles
  SET 
    status = 'changes_requested'::public.article_status,
    updated_at = timezone('utc'::text, now())
  WHERE id = p_article_id
  RETURNING * INTO v_updated;

  -- 8. 데스크 피드백 시스템 연계 (feedbacks 테이블에 자동 등록)
  INSERT INTO public.feedbacks (
    article_id,
    author_id,
    content,
    is_resolved,
    created_at
  )
  VALUES (
    p_article_id,
    v_uid,
    '[수정 요청 사유] ' || v_trimmed_reason,
    false,
    timezone('utc'::text, now())
  );

  -- 9. 원자적 버전 스냅샷 생성
  PERFORM public.create_article_version(p_article_id, '수정 요청: ' || v_trimmed_reason);

  RETURN v_updated;
END;
$$;

-- 6. RPC: approve_article
-- 데스크가 검토중인 기사를 최종 승인하여 출고 대기(ready)로 전환 (review -> ready)
CREATE OR REPLACE FUNCTION public.approve_article(p_article_id UUID)
RETURNS public.articles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_article public.articles;
  v_reviewer RECORD;
  v_author_dept UUID;
  v_updated public.articles;
BEGIN
  -- 1. 인증 확인
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '인증되지 않은 사용자입니다.';
  END IF;

  IF public.is_hr_admin(v_uid) THEN
    RAISE EXCEPTION '인사 관리자는 기사를 승인할 수 없습니다.';
  END IF;

  -- 2. 검토자 직급 및 부서 확인
  SELECT id, name, rank, role, department_id INTO v_reviewer
  FROM public.profiles
  WHERE id = v_uid;

  IF v_reviewer.id IS NULL THEN
    RAISE EXCEPTION '사용자 프로필을 찾을 수 없습니다.';
  END IF;

  IF NOT (
    v_reviewer.rank IN ('manager'::public.user_rank, 'deputy'::public.user_rank)
    OR v_reviewer.role IN ('desk_editor'::public.user_role, 'editor_in_chief'::public.user_role)
  ) THEN
    RAISE EXCEPTION '기사 승인은 데스크(부장/차장 또는 데스크 에디터)만 가능합니다.';
  END IF;

  -- 3. 대상 기사 row lock
  SELECT * INTO v_article
  FROM public.articles
  WHERE id = p_article_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '대상 기사를 찾을 수 없습니다.';
  END IF;

  -- 4. 본인 기사 자가 승인 방지
  IF v_article.author_id = v_uid THEN
    RAISE EXCEPTION '본인의 기사는 직접 승인할 수 없습니다.';
  END IF;

  -- 5. 동일 부서 검증
  SELECT department_id INTO v_author_dept
  FROM public.profiles
  WHERE id = v_article.author_id;

  IF v_author_dept IS NULL OR v_reviewer.department_id IS NULL OR v_author_dept != v_reviewer.department_id THEN
    RAISE EXCEPTION '동일한 부서 소속 기자의 기사만 승인할 수 있습니다.';
  END IF;

  -- 6. 상태 전이 검증 (review -> ready)
  IF v_article.status != 'review'::public.article_status THEN
    RAISE EXCEPTION '검토중(review) 상태의 기사만 승인할 수 있습니다. (현재 상태: %)', v_article.status;
  END IF;

  -- 7. 기사 상태를 ready(출고 대기)로 변경
  UPDATE public.articles
  SET 
    status = 'ready'::public.article_status,
    updated_at = timezone('utc'::text, now())
  WHERE id = p_article_id
  RETURNING * INTO v_updated;

  -- 8. 원자적 버전 스냅샷 생성
  PERFORM public.create_article_version(p_article_id, '출고 승인');

  RETURN v_updated;
END;
$$;

-- 7. RPC: publish_article (기존 함수 보강: 출고 성공 시 버전 스냅샷 자동 연계)
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
    updated_at = timezone('utc'::text, now())
  WHERE id = p_article_id
    AND status = 'ready'::public.article_status
  RETURNING * INTO v_updated_article;

  IF v_updated_article.id IS NULL THEN
    RAISE EXCEPTION '다른 요청에 의해 기사가 이미 출고되었거나 상태가 변경되었습니다.';
  END IF;

  -- 10. 출고 완료 버전 스냅샷 생성
  PERFORM public.create_article_version(p_article_id, '기사 최종 출고 완료');

  RETURN v_updated_article;
END;
$$;

-- 8. 함수 권한 설정
REVOKE EXECUTE ON FUNCTION public.request_article_review(UUID) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_article_review(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.request_article_changes(UUID, TEXT) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_article_changes(UUID, TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.approve_article(UUID) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_article(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.publish_article(UUID, TEXT[]) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_article(UUID, TEXT[]) TO authenticated;
