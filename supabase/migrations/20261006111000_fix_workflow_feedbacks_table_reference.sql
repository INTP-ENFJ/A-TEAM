-- ========================================================
-- PRESS-CMS: Workflow Feedback Table Reference Fix
-- ========================================================
-- request_article_changes RPC 실행 시 데스크 피드백 자동 등록 대상을
-- 실제 테이블인 public.article_feedbacks로 명확히 지정합니다.

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
  SELECT department_id INTO v_author_dept
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

  -- 8. 데스크 피드백 시스템 연계 (article_feedbacks 테이블에 자동 등록)
  INSERT INTO public.article_feedbacks (
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

-- 권한 재설정
REVOKE EXECUTE ON FUNCTION public.request_article_changes(UUID, TEXT) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_article_changes(UUID, TEXT) TO authenticated;
