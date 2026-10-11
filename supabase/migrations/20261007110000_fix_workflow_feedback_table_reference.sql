-- PRESS-CMS: Fix feedback table reference in workflow RPCs
-- request_article_changes 및 resubmit_article_review RPC에서 존재하지 않는 public.feedback 대신
-- 실제 존재하는 public.article_feedbacks 테이블을 사용하도록 수정합니다.

-- 1. request_article_changes 수정
CREATE OR REPLACE FUNCTION public.request_article_changes(
  p_article_id UUID,
  p_feedback TEXT
)
RETURNS public.articles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_reviewer RECORD;
  v_article public.articles;
  v_author RECORD;
  v_updated public.articles;
BEGIN
  -- 권한 있는 워크플로우 RPC 세션 플래그 설정
  PERFORM set_config('press.authorized_workflow_rpc', 'true', true);

  -- 1. 인증 확인
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '인증되지 않은 사용자입니다.';
  END IF;

  IF public.is_hr_admin(v_uid) THEN
    RAISE EXCEPTION '인사 관리자는 기사 수정을 요청할 수 없습니다.';
  END IF;

  -- 2. 피드백 내용 필수 검증
  IF p_feedback IS NULL OR length(trim(p_feedback)) = 0 THEN
    RAISE EXCEPTION '수정 요청 사유 및 피드백 내용은 필수입니다.';
  END IF;

  -- 3. 대상 기사 row lock (SELECT ... FOR UPDATE)
  SELECT * INTO v_article
  FROM public.articles
  WHERE id = p_article_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '대상 기사를 찾을 수 없습니다.';
  END IF;

  -- 4. 상태 검증: 오직 'review' 상태일 때만 수정 요청 가능
  IF v_article.status != 'review'::public.article_status THEN
    RAISE EXCEPTION '검토중(review) 상태의 기사만 수정 요청할 수 있습니다. (현재 상태: %)', v_article.status;
  END IF;

  -- 5. 검토자 자격 검증 (user_role enum 정확 매핑)
  SELECT id, name, department_id, rank, role INTO v_reviewer
  FROM public.profiles
  WHERE id = v_uid;

  IF NOT (
    v_reviewer.rank IN ('manager'::public.user_rank, 'deputy'::public.user_rank)
    OR v_reviewer.role IN ('desk_editor'::public.user_role, 'editor_in_chief'::public.user_role)
  ) THEN
    RAISE EXCEPTION '수정 요청은 부장(manager), 차장(deputy) 또는 데스크 역할만 수행할 수 있습니다.';
  END IF;

  -- 6. 작성자 부서 확인 및 동일 부서 검증
  SELECT id, name, department_id INTO v_author
  FROM public.profiles
  WHERE id = v_article.author_id;

  IF v_author.department_id IS DISTINCT FROM v_reviewer.department_id THEN
    RAISE EXCEPTION '동일 부서 소속의 기사만 검토/수정요청할 수 있습니다.';
  END IF;

  -- 7. 기사 상태를 changes_requested로 변경
  UPDATE public.articles
  SET 
    status = 'changes_requested'::public.article_status,
    updated_at = timezone('utc'::text, now())
  WHERE id = p_article_id
  RETURNING * INTO v_updated;

  -- 8. 피드백(article_feedbacks) 테이블에 데스크 코멘트 기록
  INSERT INTO public.article_feedbacks (
    article_id,
    author_id,
    author_name,
    author_rank,
    author_role_title,
    content,
    is_resolved,
    created_at
  ) VALUES (
    p_article_id,
    v_uid,
    v_reviewer.name,
    v_reviewer.rank,
    v_reviewer.role::text,
    trim(p_feedback),
    false,
    timezone('utc'::text, now())
  );

  -- 9. 원자적 버전 스냅샷 생성
  PERFORM public.create_article_version(p_article_id, '수정 요청: ' || substring(trim(p_feedback) from 1 for 40));

  -- 10. 원자적 감사 로그 생성
  INSERT INTO public.audit_logs (
    actor_id,
    article_id,
    project_id,
    action,
    metadata,
    created_at
  ) VALUES (
    v_uid,
    p_article_id,
    v_article.project_id,
    'CHANGES_REQUESTED',
    jsonb_build_object(
      'previous_status', 'review',
      'new_status', 'changes_requested',
      'feedback_preview', substring(trim(p_feedback) from 1 for 80)
    ),
    timezone('utc'::text, now())
  );

  -- 11. 작성자 기자에게 인앱 업무 알림 생성
  IF v_article.author_id IS NOT NULL THEN
    INSERT INTO public.notifications (
      recipient_id,
      actor_id,
      article_id,
      type,
      title,
      message,
      is_read,
      created_at
    ) VALUES (
      v_article.author_id,
      v_uid,
      p_article_id,
      'changes_requested',
      '기사 수정 요청',
      COALESCE(v_reviewer.name, '데스크') || ' 데스크가 "' || v_article.title || '" 기사에 대한 수정을 요청했습니다: ' || substring(trim(p_feedback) from 1 for 50),
      false,
      timezone('utc'::text, now())
    );
  END IF;

  RETURN v_updated;
END;
$$;

-- 2. resubmit_article_review 수정
CREATE OR REPLACE FUNCTION public.resubmit_article_review(
  p_article_id UUID,
  p_note TEXT DEFAULT NULL
)
RETURNS public.articles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_updated public.articles;
  v_reporter RECORD;
BEGIN
  -- 권한 있는 워크플로우 RPC 세션 플래그 설정
  PERFORM set_config('press.authorized_workflow_rpc', 'true', true);

  -- request_article_review 내부에서 상태/권한 검증 및 감사로그/알림 일괄 원자적 처리
  v_updated := public.request_article_review(p_article_id);
  
  -- 수정 보완 메모가 전달된 경우 피드백 기록
  IF p_note IS NOT NULL AND length(trim(p_note)) > 0 THEN
    SELECT name, rank, role INTO v_reporter
    FROM public.profiles
    WHERE id = auth.uid();

    INSERT INTO public.article_feedbacks (
      article_id,
      author_id,
      author_name,
      author_rank,
      author_role_title,
      content,
      is_resolved,
      created_at
    ) VALUES (
      p_article_id,
      auth.uid(),
      v_reporter.name,
      v_reporter.rank,
      v_reporter.role::text,
      '기자 수정 보완: ' || trim(p_note),
      false,
      timezone('utc'::text, now())
    );
  END IF;

  RETURN v_updated;
END;
$$;

-- 3. 권한 부여
REVOKE EXECUTE ON FUNCTION public.request_article_changes(UUID, TEXT) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_article_changes(UUID, TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.resubmit_article_review(UUID, TEXT) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.resubmit_article_review(UUID, TEXT) TO authenticated;
