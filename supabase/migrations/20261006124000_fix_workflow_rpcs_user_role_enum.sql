-- ========================================================
-- PRESS-CMS: Fix Workflow RPCs user_role Enum Mismatch
-- 
-- 문제:
--   request_article_review, request_article_changes,
--   approve_article, assign_article_and_deadline 함수 내부에서
--   p.role = 'desk' 를 비교하고 있었으나,
--   user_role enum에는 'desk'가 없고 ('reporter', 'desk_editor', 'editor_in_chief')만 존재함.
--   이로 인해 PostgreSQL에서 22P02: invalid input value for enum user_role: "desk"
--   오류가 발생하여 워크플로우 RPC 전체가 실패하는 결함을 원천 해결합니다.
-- ========================================================

-- 1. request_article_review 수정
CREATE OR REPLACE FUNCTION public.request_article_review(p_article_id UUID)
RETURNS public.articles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_article public.articles;
  v_author RECORD;
  v_prev_status public.article_status;
  v_reason TEXT;
  v_action_type TEXT;
  v_notif_type TEXT;
  v_notif_title TEXT;
  v_notif_message TEXT;
  v_updated public.articles;
BEGIN
  -- 권한 있는 워크플로우 RPC 세션 플래그 설정 (현재 트랜잭션 범위)
  PERFORM set_config('press.authorized_workflow_rpc', 'true', true);

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

  -- 4. 작성자 프로필 및 부서 확인
  SELECT id, name, department_id INTO v_author
  FROM public.profiles
  WHERE id = v_uid;

  -- 5. 상태 전이 검증 (draft 또는 changes_requested -> review)
  v_prev_status := v_article.status;
  IF v_prev_status NOT IN ('draft'::public.article_status, 'changes_requested'::public.article_status) THEN
    RAISE EXCEPTION '작성중(draft) 또는 수정요청(changes_requested) 상태의 기사만 검토를 요청할 수 있습니다. (현재 상태: %)', v_prev_status;
  END IF;

  IF v_prev_status = 'draft'::public.article_status THEN
    v_reason := '검토 요청';
    v_action_type := 'REVIEW_REQUESTED';
    v_notif_type := 'review_requested';
    v_notif_title := '기사 검토 요청';
    v_notif_message := COALESCE(v_author.name, '기자') || ' 기자가 "' || v_article.title || '" 기사의 검토를 요청했습니다.';
  ELSE
    v_reason := '재검토 요청';
    v_action_type := 'REVIEW_RESUBMITTED';
    v_notif_type := 'review_resubmitted';
    v_notif_title := '기사 재검토 요청';
    v_notif_message := COALESCE(v_author.name, '기자') || ' 기자가 수정한 "' || v_article.title || '" 기사의 재검토를 요청했습니다.';
  END IF;

  -- 6. 기사 상태를 review로 변경
  UPDATE public.articles
  SET 
    status = 'review'::public.article_status,
    updated_at = timezone('utc'::text, now())
  WHERE id = p_article_id
  RETURNING * INTO v_updated;

  -- 7. 원자적 버전 스냅샷 생성
  PERFORM public.create_article_version(p_article_id, v_reason);

  -- 8. 원자적 감사 로그 생성
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
    v_action_type,
    jsonb_build_object(
      'previous_status', v_prev_status::text,
      'new_status', 'review'
    ),
    timezone('utc'::text, now())
  );

  -- 9. 동일 부서 데스크 사용자들에게 인앱 업무 알림 생성 (user_role enum 정확 매핑)
  IF v_author.department_id IS NOT NULL THEN
    INSERT INTO public.notifications (
      recipient_id,
      actor_id,
      article_id,
      type,
      title,
      message,
      is_read,
      created_at
    )
    SELECT DISTINCT
      p.id AS recipient_id,
      v_uid AS actor_id,
      p_article_id AS article_id,
      v_notif_type AS type,
      v_notif_title AS title,
      v_notif_message AS message,
      false AS is_read,
      timezone('utc'::text, now()) AS created_at
    FROM public.profiles p
    WHERE p.department_id = v_author.department_id
      AND p.id != v_uid
      AND (
        p.rank IN ('manager'::public.user_rank, 'deputy'::public.user_rank)
        OR p.role IN ('desk_editor'::public.user_role, 'editor_in_chief'::public.user_role)
      );
  END IF;

  RETURN v_updated;
END;
$$;

-- 2. request_article_changes 수정
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

  -- 8. 피드백(feedback) 테이블에 데스크 코멘트 기록
  INSERT INTO public.feedback (
    article_id,
    reviewer_id,
    content,
    created_at
  ) VALUES (
    p_article_id,
    v_uid,
    trim(p_feedback),
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

-- 3. approve_article 수정
CREATE OR REPLACE FUNCTION public.approve_article(p_article_id UUID)
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
    RAISE EXCEPTION '인사 관리자는 기사를 승인할 수 없습니다.';
  END IF;

  -- 2. 대상 기사 row lock (SELECT ... FOR UPDATE)
  SELECT * INTO v_article
  FROM public.articles
  WHERE id = p_article_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '대상 기사를 찾을 수 없습니다.';
  END IF;

  -- 3. 상태 검증: 오직 'review' 상태일 때만 승인 가능
  IF v_article.status != 'review'::public.article_status THEN
    RAISE EXCEPTION '검토중(review) 상태의 기사만 승인할 수 있습니다. (현재 상태: %)', v_article.status;
  END IF;

  -- 4. 자가 승인(Self-approval) 엄격 차단
  IF v_article.author_id = v_uid THEN
    RAISE EXCEPTION '본인이 작성한 기사는 직접 승인할 수 없습니다.';
  END IF;

  -- 5. 검토자 자격 검증 (user_role enum 정확 매핑)
  SELECT id, name, department_id, rank, role INTO v_reviewer
  FROM public.profiles
  WHERE id = v_uid;

  IF NOT (
    v_reviewer.rank IN ('manager'::public.user_rank, 'deputy'::public.user_rank)
    OR v_reviewer.role IN ('desk_editor'::public.user_role, 'editor_in_chief'::public.user_role)
  ) THEN
    RAISE EXCEPTION '기사 승인은 부장(manager), 차장(deputy) 또는 데스크 역할만 수행할 수 있습니다.';
  END IF;

  -- 6. 작성자 부서 확인 및 동일 부서 검증
  SELECT id, name, department_id INTO v_author
  FROM public.profiles
  WHERE id = v_article.author_id;

  IF v_author.department_id IS DISTINCT FROM v_reviewer.department_id THEN
    RAISE EXCEPTION '동일 부서 소속의 기사만 승인할 수 있습니다.';
  END IF;

  -- 7. 기사 상태를 ready(출고대기)로 변경
  UPDATE public.articles
  SET 
    status = 'ready'::public.article_status,
    updated_at = timezone('utc'::text, now())
  WHERE id = p_article_id
  RETURNING * INTO v_updated;

  -- 8. 원자적 버전 스냅샷 생성
  PERFORM public.create_article_version(p_article_id, '데스크 기사 승인 완료 (출고 대기)');

  -- 9. 원자적 감사 로그 생성
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
    'ARTICLE_APPROVED',
    jsonb_build_object(
      'previous_status', 'review',
      'new_status', 'ready'
    ),
    timezone('utc'::text, now())
  );

  -- 10. 작성자 기자에게 인앱 업무 알림 생성
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
      'article_approved',
      '기사 승인 완료',
      COALESCE(v_reviewer.name, '데스크') || ' 데스크가 "' || v_article.title || '" 기사를 승인했습니다. (출고 대기 전환)',
      false,
      timezone('utc'::text, now())
    );
  END IF;

  RETURN v_updated;
END;
$$;

-- 4. assign_article_and_deadline 수정
CREATE OR REPLACE FUNCTION public.assign_article_and_deadline(
  p_article_id UUID,
  p_author_id UUID DEFAULT NULL,
  p_deadline_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS public.articles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_caller RECORD;
  v_article public.articles;
  v_new_author RECORD;
  v_updated public.articles;
  v_author_changed BOOLEAN := false;
  v_deadline_changed BOOLEAN := false;
  v_old_author_id UUID;
  v_old_deadline TIMESTAMPTZ;
BEGIN
  -- 권한 있는 워크플로우 RPC 세션 플래그 설정
  PERFORM set_config('press.authorized_workflow_rpc', 'true', true);

  -- 1. 인증 확인
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '인증되지 않은 사용자입니다.';
  END IF;

  IF public.is_hr_admin(v_uid) THEN
    RAISE EXCEPTION '인사 관리자는 기사를 배정하거나 마감시간을 변경할 수 없습니다.';
  END IF;

  -- 2. 호출자의 권한 검증 (user_role enum 정확 매핑)
  SELECT id, name, department_id, rank, role INTO v_caller
  FROM public.profiles
  WHERE id = v_uid;

  IF NOT (
    v_caller.rank IN ('manager'::public.user_rank, 'deputy'::public.user_rank)
    OR v_caller.role IN ('desk_editor'::public.user_role, 'editor_in_chief'::public.user_role)
  ) THEN
    RAISE EXCEPTION '기사 배정 및 마감시간 변경은 데스크(부장/차장 또는 데스크 역할)만 가능합니다.';
  END IF;

  -- 3. 대상 기사 row lock
  SELECT * INTO v_article
  FROM public.articles
  WHERE id = p_article_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '대상 기사를 찾을 수 없습니다.';
  END IF;

  -- 4. 출고 완료(published) 기사는 배정 및 마감 변경 불가
  IF v_article.status = 'published'::public.article_status THEN
    RAISE EXCEPTION '출고 완료된 기사는 배정이나 마감시간을 변경할 수 없습니다.';
  END IF;

  v_old_author_id := v_article.author_id;
  v_old_deadline := v_article.deadline_at;

  -- 5. 새 담당 기자 유효성 및 부서 검증
  IF p_author_id IS NOT NULL AND p_author_id != v_old_author_id THEN
    SELECT id, name, department_id INTO v_new_author
    FROM public.profiles
    WHERE id = p_author_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION '지정된 담당 기자를 찾을 수 없습니다.';
    END IF;

    IF v_caller.department_id IS NOT NULL AND v_new_author.department_id IS DISTINCT FROM v_caller.department_id THEN
      RAISE EXCEPTION '동일 부서 소속의 기자에게만 기사를 배정할 수 있습니다.';
    END IF;

    v_author_changed := true;
  END IF;

  IF p_deadline_at IS DISTINCT FROM v_old_deadline THEN
    v_deadline_changed := true;
  END IF;

  -- 변경사항이 없으면 기존 row 반환
  IF NOT v_author_changed AND NOT v_deadline_changed THEN
    RETURN v_article;
  END IF;

  -- 6. 기사 정보 원자적 업데이트
  UPDATE public.articles
  SET 
    author_id = CASE WHEN v_author_changed THEN p_author_id ELSE author_id END,
    deadline_at = CASE WHEN v_deadline_changed THEN p_deadline_at ELSE deadline_at END,
    updated_at = timezone('utc'::text, now())
  WHERE id = p_article_id
  RETURNING * INTO v_updated;

  -- 7. 원자적 감사 로그 생성
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
    'ARTICLE_ASSIGNED',
    jsonb_build_object(
      'author_changed', v_author_changed,
      'old_author_id', v_old_author_id,
      'new_author_id', CASE WHEN v_author_changed THEN p_author_id ELSE v_old_author_id END,
      'deadline_changed', v_deadline_changed,
      'old_deadline', v_old_deadline,
      'new_deadline', CASE WHEN v_deadline_changed THEN p_deadline_at ELSE v_old_deadline END
    ),
    timezone('utc'::text, now())
  );

  -- 8. 배정된 기자에게 알림 생성
  IF v_author_changed AND p_author_id IS NOT NULL THEN
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
      p_author_id,
      v_uid,
      p_article_id,
      'article_assigned',
      '기사 배정 알림',
      COALESCE(v_caller.name, '데스크') || ' 데스크가 "' || v_article.title || '" 기사를 배정했습니다.',
      false,
      timezone('utc'::text, now())
    );
  END IF;

  RETURN v_updated;
END;
$$;

-- 권한 부여
REVOKE EXECUTE ON FUNCTION public.request_article_review(UUID) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_article_review(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.request_article_changes(UUID, TEXT) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_article_changes(UUID, TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.approve_article(UUID) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_article(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.assign_article_and_deadline(UUID, UUID, TIMESTAMPTZ) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_article_and_deadline(UUID, UUID, TIMESTAMPTZ) TO authenticated;
