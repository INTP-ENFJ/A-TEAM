-- ========================================================
-- PRESS-CMS: Publish Preflight (출고 전 최종 검증) Migration
-- ========================================================
-- 1. 단일 인자 can_access_article(UUID) 헬퍼 보장
-- 2. validate_article_for_publish(UUID, TEXT[]) RPC 구현
-- 3. publish_article(UUID, TEXT[]) RPC 내 트랜잭션 최종 검증 강제

-- 1. 단일 인자 can_access_article(p_article_id, p_uid) 헬퍼
CREATE OR REPLACE FUNCTION public.can_access_article(
  p_article_id UUID,
  p_uid UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    (
      SELECT public.can_access_article(a.project_id, a.author_id, a.status, p_uid)
      FROM public.articles a
      WHERE a.id = p_article_id
    ),
    false
  );
$$;

REVOKE EXECUTE ON FUNCTION public.can_access_article(UUID, UUID) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_article(UUID, UUID) TO authenticated;

-- 2. validate_article_for_publish RPC
-- 출고 전 기사의 적합성(상태, 제목, 실질 본문 텍스트 유무, 채널 선택, 엠바고)을 종합 검증
CREATE OR REPLACE FUNCTION public.validate_article_for_publish(
  p_article_id UUID,
  p_channels TEXT[] DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_reviewer_rank public.user_rank;
  v_reviewer_dept UUID;
  v_author_dept UUID;
  v_article public.articles;
  v_text_block_count INT := 0;
  v_issues JSONB := '[]'::jsonb;
  v_status_ready BOOLEAN := false;
  v_title_valid BOOLEAN := false;
  v_body_valid BOOLEAN := false;
  v_channels_valid BOOLEAN := false;
  v_embargo_valid BOOLEAN := false;
  v_permission_valid BOOLEAN := false;
  v_effective_channels TEXT[];
BEGIN
  -- 1. 사용자 인증 확인
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object(
      'valid', false,
      'article_id', p_article_id,
      'checks', jsonb_build_object(
        'status_ready', false,
        'title_valid', false,
        'body_valid', false,
        'channels_valid', false,
        'embargo_valid', false,
        'permission_valid', false
      ),
      'issues', jsonb_build_array(
        jsonb_build_object('code', 'UNAUTHENTICATED', 'message', '인증되지 않은 사용자입니다.')
      )
    );
  END IF;

  -- 2. 대상 기사 조회
  SELECT * INTO v_article
  FROM public.articles
  WHERE id = p_article_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'valid', false,
      'article_id', p_article_id,
      'checks', jsonb_build_object(
        'status_ready', false,
        'title_valid', false,
        'body_valid', false,
        'channels_valid', false,
        'embargo_valid', false,
        'permission_valid', false
      ),
      'issues', jsonb_build_array(
        jsonb_build_object('code', 'ARTICLE_NOT_FOUND', 'message', '출고 대상 기사를 찾을 수 없습니다.')
      )
    );
  END IF;

  -- 3. 권한 및 직급 확인
  IF public.is_hr_admin(v_uid) THEN
    v_issues := v_issues || jsonb_build_object(
      'code', 'HR_ADMIN_BLOCKED',
      'message', '인사 관리자는 기사 출고 권한이 없습니다.'
    );
  ELSE
    SELECT rank, department_id INTO v_reviewer_rank, v_reviewer_dept
    FROM public.profiles
    WHERE id = v_uid;

    SELECT department_id INTO v_author_dept
    FROM public.profiles
    WHERE id = v_article.author_id;

    IF v_reviewer_rank = 'manager'::public.user_rank AND v_reviewer_dept IS NOT NULL AND v_reviewer_dept = v_author_dept THEN
      v_permission_valid := true;
    ELSE
      v_issues := v_issues || jsonb_build_object(
        'code', 'INSUFFICIENT_PERMISSIONS',
        'message', '기사 출고는 동일 부서 소속의 부장(manager) 직급만 가능합니다.'
      );
    END IF;
  END IF;

  -- 4. 기사 상태 검증 (반드시 ready 이어야 함)
  IF v_article.status = 'ready'::public.article_status THEN
    v_status_ready := true;
  ELSE
    v_issues := v_issues || jsonb_build_object(
      'code', 'INVALID_STATUS',
      'message', '기사가 출고 대기(ready) 상태가 아닙니다. (현재 상태: ' || v_article.status::text || ')'
    );
  END IF;

  -- 5. 기사 제목 검증 (공백 제외 1글자 이상)
  IF LENGTH(TRIM(COALESCE(v_article.title, ''))) > 0 THEN
    v_title_valid := true;
  ELSE
    v_issues := v_issues || jsonb_build_object(
      'code', 'EMPTY_TITLE',
      'message', '기사 제목이 입력되지 않았습니다.'
    );
  END IF;

  -- 6. 본문 실질 텍스트 검증 (media-only 불허, 실질적인 텍스트 본문 최소 1개 이상 존재)
  SELECT COUNT(*) INTO v_text_block_count
  FROM public.article_blocks
  WHERE article_id = p_article_id
    AND LENGTH(TRIM(COALESCE(text, ''))) > 0;

  IF v_text_block_count > 0 THEN
    v_body_valid := true;
  ELSE
    v_issues := v_issues || jsonb_build_object(
      'code', 'EMPTY_BODY',
      'message', '실질적인 텍스트 본문 블록이 최소 1개 이상 존재해야 합니다.'
    );
  END IF;

  -- 7. 출고 대상 채널 검증
  v_effective_channels := COALESCE(p_channels, v_article.publish_destinations);
  IF v_effective_channels IS NOT NULL AND cardinality(v_effective_channels) > 0 THEN
    v_channels_valid := true;
  ELSE
    v_issues := v_issues || jsonb_build_object(
      'code', 'NO_CHANNELS',
      'message', '최소 1개 이상의 출고 채널을 지정해야 합니다.'
    );
  END IF;

  -- 8. 엠바고 검증 (미래 시각인 경우 즉시 출고 차단)
  IF v_article.embargo IS NOT NULL AND v_article.embargo > timezone('utc'::text, now()) THEN
    v_issues := v_issues || jsonb_build_object(
      'code', 'FUTURE_EMBARGO',
      'message', '엠바고 시각(' || to_char(v_article.embargo, 'YYYY-MM-DD HH24:MI:SS') || ')이 현재 시각 이후로 설정되어 있어 즉시 출고할 수 없습니다.'
    );
  ELSE
    v_embargo_valid := true;
  END IF;

  -- 결과 반환
  RETURN jsonb_build_object(
    'valid', (jsonb_array_length(v_issues) = 0),
    'article_id', p_article_id,
    'checks', jsonb_build_object(
      'status_ready', v_status_ready,
      'title_valid', v_title_valid,
      'body_valid', v_body_valid,
      'channels_valid', v_channels_valid,
      'embargo_valid', v_embargo_valid,
      'permission_valid', v_permission_valid
    ),
    'issues', v_issues
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.validate_article_for_publish(UUID, TEXT[]) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_article_for_publish(UUID, TEXT[]) TO authenticated;

-- 3. publish_article RPC 원자적 트랜잭션 내 최종 Preflight 검증 강제
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
  v_project_id UUID;
  v_updated_article public.articles;
  v_target_title TEXT;
  v_target_embargo TIMESTAMPTZ;
  v_text_block_count INT := 0;
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
    RAISE EXCEPTION '출고 검증 실패: 최소 1개 이상의 출고 채널을 지정해야 합니다.';
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
  SELECT status, author_id, project_id, title, embargo
  INTO v_current_status, v_author_id, v_project_id, v_target_title, v_target_embargo
  FROM public.articles
  WHERE id = p_article_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '출고 대상 기사를 찾을 수 없습니다.';
  END IF;

  -- 6. 출고 대기(ready) 상태 검증
  IF v_current_status != 'ready'::public.article_status THEN
    RAISE EXCEPTION '출고 검증 실패: 출고 대기(ready) 상태의 기사만 출고할 수 있습니다. (현재 상태: %)', v_current_status;
  END IF;

  -- 7. 제목 검증 (공백 제외 1자 이상)
  IF LENGTH(TRIM(COALESCE(v_target_title, ''))) = 0 THEN
    RAISE EXCEPTION '출고 검증 실패: 기사 제목이 입력되지 않았습니다.';
  END IF;

  -- 8. 본문 실질 텍스트 검증 (media-only 불허, 실질 본문 블록 1개 이상 필수)
  SELECT COUNT(*) INTO v_text_block_count
  FROM public.article_blocks
  WHERE article_id = p_article_id
    AND LENGTH(TRIM(COALESCE(text, ''))) > 0;

  IF v_text_block_count = 0 THEN
    RAISE EXCEPTION '출고 검증 실패: 실질적인 텍스트 본문 블록이 최소 1개 이상 존재해야 합니다.';
  END IF;

  -- 9. 엠바고 검증 (미래 시각 즉시 차단)
  IF v_target_embargo IS NOT NULL AND v_target_embargo > timezone('utc'::text, now()) THEN
    RAISE EXCEPTION '출고 검증 실패: 엠바고 시각(%)이 현재 시각 이후로 설정되어 있어 즉시 출고할 수 없습니다.', v_target_embargo;
  END IF;

  -- 10. 기사 작성자의 소속 부서 확인
  SELECT department_id INTO v_author_dept
  FROM public.profiles
  WHERE id = v_author_id;

  IF v_author_dept IS NULL THEN
    RAISE EXCEPTION '기사 작성자의 소속 부서 정보가 존재하지 않습니다.';
  END IF;

  -- 11. 동일 부서 소속 검증
  IF v_reviewer_dept != v_author_dept THEN
    RAISE EXCEPTION '동일한 부서 소속 기자의 기사만 출고할 수 있습니다.';
  END IF;

  -- 12. 원자적 UPDATE (동시성 방지를 위해 WHERE status = 'ready' 재확인)
  UPDATE public.articles
  SET 
    status = 'published'::public.article_status,
    publish_destinations = p_channels,
    updated_at = timezone('utc'::text, now())
  WHERE id = p_article_id
    AND status = 'ready'::public.article_status
  RETURNING * INTO v_updated_article;

  IF NOT FOUND THEN
    RAISE EXCEPTION '기사 상태가 변경되었거나 출고 처리할 수 없습니다.';
  END IF;

  -- 13. 버전 스냅샷 생성
  PERFORM public.create_article_version(
    p_article_id,
    '최종 기사 출고: [' || array_to_string(p_channels, ', ') || ']'
  );

  -- 14. 원자적 감사 로그 생성
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
    v_project_id,
    'ARTICLE_PUBLISHED',
    jsonb_build_object(
      'previous_status', 'ready',
      'new_status', 'published',
      'channels', p_channels
    ),
    timezone('utc'::text, now())
  );

  -- 15. 기사 작성자에게 인앱 업무 알림 생성
  INSERT INTO public.notifications (
    recipient_id,
    sender_id,
    article_id,
    project_id,
    type,
    title,
    content,
    created_at
  ) VALUES (
    v_author_id,
    v_uid,
    p_article_id,
    v_project_id,
    'ARTICLE_PUBLISHED',
    '기사 출고 완료',
    '기사가 성공적으로 최종 출고되었습니다. 출고 채널: ' || array_to_string(p_channels, ', '),
    timezone('utc'::text, now())
  );

  RETURN v_updated_article;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.publish_article(UUID, TEXT[]) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_article(UUID, TEXT[]) TO authenticated;
