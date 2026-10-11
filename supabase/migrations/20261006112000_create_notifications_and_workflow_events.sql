-- ========================================================
-- PRESS-CMS: Notifications Table & Workflow Events Integration
-- ========================================================
-- 1. notifications 테이블 생성
-- 2. 인덱스 및 RLS 보안 정책 구성
-- 3. 알림 읽음 처리 RPC 함수 추가
-- 4. Workflow RPC 4종에 서버 원자적 알림 INSERT 확장

-- 1. notifications 테이블 생성
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  article_id UUID REFERENCES public.articles(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (
    type IN (
      'review_requested',
      'changes_requested',
      'review_resubmitted',
      'article_approved',
      'article_published'
    )
  ),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 2. 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_unread 
  ON public.notifications (recipient_id, is_read, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_article 
  ON public.notifications (article_id);

-- 3. RLS 보안 정책 설정
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications_select_recipient" ON public.notifications;
CREATE POLICY "notifications_select_recipient" 
  ON public.notifications 
  FOR SELECT 
  TO authenticated 
  USING (recipient_id = auth.uid());

DROP POLICY IF EXISTS "notifications_update_recipient" ON public.notifications;
CREATE POLICY "notifications_update_recipient" 
  ON public.notifications 
  FOR UPDATE 
  TO authenticated 
  USING (recipient_id = auth.uid())
  WITH CHECK (recipient_id = auth.uid());

-- 4. 읽음 처리 전용 RPC 함수
CREATE OR REPLACE FUNCTION public.mark_notification_as_read(p_notification_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '인증되지 않은 사용자입니다.';
  END IF;

  UPDATE public.notifications
  SET is_read = true
  WHERE id = p_notification_id
    AND recipient_id = v_uid;

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_all_notifications_as_read()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_count INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '인증되지 않은 사용자입니다.';
  END IF;

  UPDATE public.notifications
  SET is_read = true
  WHERE recipient_id = v_uid
    AND is_read = false;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ========================================================
-- 5. Workflow RPC 보강: 검토 요청 시 알림 생성
-- ========================================================
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
  v_notif_type TEXT;
  v_notif_title TEXT;
  v_notif_message TEXT;
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
    v_notif_type := 'review_requested';
    v_notif_title := '기사 검토 요청';
    v_notif_message := COALESCE(v_author.name, '기자') || ' 기자가 "' || v_article.title || '" 기사의 검토를 요청했습니다.';
  ELSE
    v_reason := '재검토 요청';
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

  -- 8. 동일 부서 데스크 사용자들에게 인앱 업무 알림 생성 (중복 제거)
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

-- ========================================================
-- 6. Workflow RPC 보강: 수정 요청 시 알림 생성
-- ========================================================
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

  -- 10. 기사 작성자에게 인앱 업무 알림 생성
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
  VALUES (
    v_article.author_id,
    v_uid,
    p_article_id,
    'changes_requested',
    '기사 수정 요청',
    COALESCE(v_reviewer.name, '데스크') || ' 데스크가 "' || v_article.title || '" 기사에 수정을 요청했습니다.',
    false,
    timezone('utc'::text, now())
  );

  RETURN v_updated;
END;
$$;

-- ========================================================
-- 7. Workflow RPC 보강: 승인 시 알림 생성
-- ========================================================
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

  -- 9. 기사 작성자에게 인앱 업무 알림 생성
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
  VALUES (
    v_article.author_id,
    v_uid,
    p_article_id,
    'article_approved',
    '기사 승인 완료',
    '"' || v_article.title || '" 기사가 승인되어 출고 대기 상태로 전환되었습니다.',
    false,
    timezone('utc'::text, now())
  );

  RETURN v_updated;
END;
$$;

-- ========================================================
-- 8. Workflow RPC 보강: 출고 시 알림 생성
-- ========================================================
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

  IF NOT FOUND THEN
    RAISE EXCEPTION '기사 상태가 변경되었거나 출고 처리할 수 없습니다.';
  END IF;

  -- 10. 버전 스냅샷 생성
  PERFORM public.create_article_version(
    p_article_id,
    '최종 기사 출고: [' || array_to_string(p_channels, ', ') || ']'
  );

  -- 11. 기사 작성자에게 인앱 업무 알림 생성
  -- (작성자가 부장 본인이 아닌 경우에만 알림 생성하여 중복 방지)
  IF v_author_id != v_uid THEN
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
    VALUES (
      v_author_id,
      v_uid,
      p_article_id,
      'article_published',
      '기사 출고 완료',
      '"' || v_updated_article.title || '" 기사가 성공적으로 출고되었습니다.',
      false,
      timezone('utc'::text, now())
    );
  END IF;

  RETURN v_updated_article;
END;
$$;
