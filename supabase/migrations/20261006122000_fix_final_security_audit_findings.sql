-- ========================================================
-- PRESS-CMS: Final Security Audit Remediation Migration
-- ========================================================
-- 1. [HIGH 1] articles 직접 UPDATE를 통한 Workflow/Assignment 우회 원천 차단
--    - BEFORE UPDATE 트리거(guard_article_protected_fields)를 통해
--      status, author_id, deadline_at, project_id의 일반 클라이언트 직접 변경 차단
--    - 전용 워크플로우/배정/출고 RPC(SECURITY DEFINER) 및 승인된 세션 플래그만 허용
--    - articles UPDATE RLS 정책의 manager 직접 published 변경 예외 조항 제거
-- 2. [MEDIUM] Storage API 및 DB 직접 DELETE를 통한 사용 중 미디어 삭제 우회 원천 차단
--    - storage.objects DELETE RLS: article_blocks에서 참조 중인 파일 삭제 차단
--    - public.media DELETE RLS: article_blocks에서 참조 중인 미디어 삭제 차단
-- 3. [RPC Session Flag] 주요 워크플로우/배정/출고 RPC에 안전한 로컬 세션 플래그 보장

-- --------------------------------------------------------
-- 1. articles 보호 필드 가드 트리거 함수 및 트리거 설정
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_article_protected_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- 보호 대상 핵심 필드가 변경되었는지 검사
  -- 1) status (워크플로우 상태)
  -- 2) author_id (담당 기자)
  -- 3) deadline_at (마감 일시)
  -- 4) project_id (소속 프로젝트)
  IF (NEW.status IS DISTINCT FROM OLD.status) OR
     (NEW.author_id IS DISTINCT FROM OLD.author_id) OR
     (NEW.deadline_at IS DISTINCT FROM OLD.deadline_at) OR
     (NEW.project_id IS DISTINCT FROM OLD.project_id) THEN

    -- 허용 검사:
    -- 1. 시스템 SECURITY DEFINER 함수 컨텍스트: current_user가 함수의 owner('postgres')로 전환된 경우
    -- 2. 세션 플래그 press.authorized_workflow_rpc = 'true'
    IF (current_user = 'authenticated' OR current_user = 'anon') AND
       (current_setting('press.authorized_workflow_rpc', true) IS DISTINCT FROM 'true') THEN

      IF NEW.status IS DISTINCT FROM OLD.status THEN
        RAISE EXCEPTION '기사 상태(status)는 직접 수정할 수 없으며 전용 워크플로우 RPC를 통해서만 변경 가능합니다.';
      ELSIF (NEW.author_id IS DISTINCT FROM OLD.author_id) OR (NEW.deadline_at IS DISTINCT FROM OLD.deadline_at) THEN
        RAISE EXCEPTION '담당 기자(author_id) 및 마감일(deadline_at)은 직접 수정할 수 없으며 기사 배정 RPC를 통해서만 변경 가능합니다.';
      ELSE
        RAISE EXCEPTION '소속 프로젝트(project_id)는 직접 변경할 수 없습니다.';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_article_protected_fields ON public.articles;
CREATE TRIGGER trg_guard_article_protected_fields
BEFORE UPDATE ON public.articles
FOR EACH ROW
EXECUTE FUNCTION public.guard_article_protected_fields();

-- articles UPDATE RLS 정책 갱신 (manager 직접 published 우회 제거)
DROP POLICY IF EXISTS "Owners can update articles" ON public.articles;
CREATE POLICY "Owners can update articles" ON public.articles
FOR UPDATE TO authenticated
USING (
  NOT public.is_hr_admin(auth.uid())
  AND (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = public.articles.project_id
        AND p.owner_id = auth.uid()
    )
  )
)
WITH CHECK (
  NOT public.is_hr_admin(auth.uid())
  AND status != 'published'::public.article_status
);

-- --------------------------------------------------------
-- 2. 사용 중인 미디어 직접 삭제 우회 차단 (Storage & DB RLS)
-- --------------------------------------------------------
-- 2-1. storage.objects DELETE RLS 보강
DROP POLICY IF EXISTS "Project owners can delete media objects" ON storage.objects;
CREATE POLICY "Project owners can delete media objects" ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'newsroom-media'
  AND NOT public.is_hr_admin(auth.uid())
  AND ((storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  AND EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = ((storage.foldername(storage.objects.name))[1])::uuid
      AND p.owner_id = auth.uid()
  )
  -- 기사 본문(article_blocks)에서 사용 중인 미디어는 직접 Storage 삭제 절대 차단
  AND NOT EXISTS (
    SELECT 1 FROM public.article_blocks b
    WHERE b.media_url = storage.objects.name
  )
);

-- 2-2. public.media 테이블 DELETE RLS 보강
DROP POLICY IF EXISTS "Project owners can delete media" ON public.media;
CREATE POLICY "Project owners can delete media" ON public.media
FOR DELETE TO authenticated
USING (
  NOT public.is_hr_admin(auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = public.media.project_id
      AND p.owner_id = auth.uid()
  )
  -- 기사 본문(article_blocks)에서 사용 중인 미디어는 직접 DB 레코드 삭제 절대 차단
  AND NOT EXISTS (
    SELECT 1 FROM public.article_blocks b
    WHERE b.media_url = public.media.storage_path
  )
);

-- --------------------------------------------------------
-- 3. 주요 워크플로우 / 배정 / 출고 RPC 함수에 안전 플래그 보장
-- --------------------------------------------------------

-- 3-1. request_article_review
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

  -- 9. 동일 부서 데스크 사용자들에게 인앱 업무 알림 생성
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
        OR p.role = 'desk'
      );
  END IF;

  RETURN v_updated;
END;
$$;

-- 3-2. request_article_changes
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
    RAISE EXCEPTION '인사 관리자는 기사 워크플로우를 처리할 수 없습니다.';
  END IF;

  -- 2. 피드백 내용 검증
  IF p_feedback IS NULL OR length(trim(p_feedback)) = 0 THEN
    RAISE EXCEPTION '수정 요청 시 피드백 내용을 반드시 입력해야 합니다.';
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

  -- 5. 검토자 자격 검증 (데스크 직급/역할)
  SELECT id, name, department_id, rank, role INTO v_reviewer
  FROM public.profiles
  WHERE id = v_uid;

  IF NOT (
    v_reviewer.rank IN ('manager'::public.user_rank, 'deputy'::public.user_rank)
    OR v_reviewer.role = 'desk'
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
  IF v_article.author_id IS NOT NULL AND v_article.author_id != v_uid THEN
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

-- 3-3. resubmit_article_review
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
BEGIN
  -- 권한 있는 워크플로우 RPC 세션 플래그 설정
  PERFORM set_config('press.authorized_workflow_rpc', 'true', true);

  -- request_article_review 내부에서 상태/권한 검증 및 감사로그/알림 일괄 원자적 처리
  v_updated := public.request_article_review(p_article_id);
  
  -- 수정 보완 메모가 전달된 경우 피드백 기록
  IF p_note IS NOT NULL AND length(trim(p_note)) > 0 THEN
    INSERT INTO public.feedback (
      article_id,
      reviewer_id,
      content,
      created_at
    ) VALUES (
      p_article_id,
      auth.uid(),
      '기자 수정 보완: ' || trim(p_note),
      timezone('utc'::text, now())
    );
  END IF;

  RETURN v_updated;
END;
$$;

-- 3-4. approve_article
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

  -- 5. 검토자 자격 검증 (데스크 직급/역할)
  SELECT id, name, department_id, rank, role INTO v_reviewer
  FROM public.profiles
  WHERE id = v_uid;

  IF NOT (
    v_reviewer.rank IN ('manager'::public.user_rank, 'deputy'::public.user_rank)
    OR v_reviewer.role = 'desk'
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

  -- 7. 기사 상태를 ready로 변경
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

-- 3-5. assign_article_and_deadline
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

  -- 2. 호출자의 권한 검증 (데스크 역할 또는 부장/차장 직급 필수)
  SELECT id, name, department_id, rank, role INTO v_caller
  FROM public.profiles
  WHERE id = v_uid;

  IF NOT (
    v_caller.rank IN ('manager'::public.user_rank, 'deputy'::public.user_rank)
    OR v_caller.role = 'desk'
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

  -- 6. 마감시간 변경 여부 확인
  IF p_deadline_at IS DISTINCT FROM v_old_deadline THEN
    v_deadline_changed := true;
  END IF;

  -- 변경 사항이 없으면 현재 상태 그대로 반환
  IF NOT v_author_changed AND NOT v_deadline_changed THEN
    RETURN v_article;
  END IF;

  -- 7. 기사 레코드 원자적 업데이트
  UPDATE public.articles
  SET
    author_id = CASE WHEN v_author_changed THEN p_author_id ELSE author_id END,
    deadline_at = CASE WHEN v_deadline_changed THEN p_deadline_at ELSE deadline_at END,
    updated_at = timezone('utc'::text, now())
  WHERE id = p_article_id
  RETURNING * INTO v_updated;

  -- 8. 원자적 감사 로그 생성
  IF v_author_changed THEN
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
        'previous_author_id', v_old_author_id,
        'new_author_id', p_author_id,
        'new_author_name', v_new_author.name
      ),
      timezone('utc'::text, now())
    );
  END IF;

  IF v_deadline_changed THEN
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
      'DEADLINE_CHANGED',
      jsonb_build_object(
        'previous_deadline', v_old_deadline,
        'new_deadline', p_deadline_at
      ),
      timezone('utc'::text, now())
    );
  END IF;

  -- 9. 인앱 업무 알림 생성
  IF v_author_changed AND p_author_id != v_uid THEN
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

  IF v_deadline_changed AND v_updated.author_id IS NOT NULL AND v_updated.author_id != v_uid THEN
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
      v_updated.author_id,
      v_uid,
      p_article_id,
      'deadline_changed',
      '기사 마감시간 변경',
      COALESCE(v_caller.name, '데스크') || ' 데스크가 "' || v_article.title || '" 기사의 마감시간을 변경했습니다.',
      false,
      timezone('utc'::text, now())
    );
  END IF;

  RETURN v_updated;
END;
$$;

-- 3-6. publish_article
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
  -- 권한 있는 워크플로우 RPC 세션 플래그 설정
  PERFORM set_config('press.authorized_workflow_rpc', 'true', true);

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

  -- 5. 대상 기사 row lock (SELECT ... FOR UPDATE)
  SELECT status, author_id, project_id, title, embargo
  INTO v_current_status, v_author_id, v_project_id, v_target_title, v_target_embargo
  FROM public.articles
  WHERE id = p_article_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '대상 기사를 찾을 수 없습니다.';
  END IF;

  -- 6. 상태 검증: 오직 'ready' 상태일 때만 출고 가능
  IF v_current_status != 'ready'::public.article_status THEN
    RAISE EXCEPTION '출고대기(ready) 상태의 기사만 출고할 수 있습니다. (현재 상태: %)', v_current_status;
  END IF;

  -- 7. 작성자 부서 확인 및 동일 부서 검증
  SELECT department_id INTO v_author_dept
  FROM public.profiles
  WHERE id = v_author_id;

  IF v_author_dept IS NULL OR v_author_dept != v_reviewer_dept THEN
    RAISE EXCEPTION '동일 부서 소속의 기사만 출고할 수 있습니다.';
  END IF;

  -- ========================================================
  -- [핵심 원자적 Preflight 검증]
  -- ========================================================
  IF v_target_title IS NULL OR length(trim(v_target_title)) = 0 THEN
    RAISE EXCEPTION '출고 검증 실패: 기사 제목이 입력되지 않았습니다.';
  END IF;

  SELECT COUNT(*) INTO v_text_block_count
  FROM public.article_blocks b
  WHERE b.article_id = p_article_id
    AND b.type = 'paragraph'
    AND b.text IS NOT NULL
    AND length(trim(b.text)) > 0;

  IF v_text_block_count = 0 THEN
    RAISE EXCEPTION '출고 검증 실패: 기사 본문에 실질적인 텍스트 내용이 최소 1개 문단 이상 포함되어야 출고할 수 있습니다.';
  END IF;

  IF v_target_embargo IS NOT NULL AND v_target_embargo > timezone('utc'::text, now()) THEN
    RAISE EXCEPTION '출고 검증 실패: 엠바고 시점(%)이 아직 해제되지 않아 출고할 수 없습니다.', v_target_embargo;
  END IF;

  -- 8. articles 레코드 업데이트 (published 상태 전환, 채널 저장)
  UPDATE public.articles
  SET
    status = 'published'::public.article_status,
    publish_destinations = p_channels,
    updated_at = timezone('utc'::text, now())
  WHERE id = p_article_id
  RETURNING * INTO v_updated_article;

  -- 9. 원자적 버전 스냅샷 생성
  PERFORM public.create_article_version(
    p_article_id,
    '최종 출고 (배포처: ' || array_to_string(p_channels, ', ') || ')'
  );

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
    v_project_id,
    'ARTICLE_PUBLISHED',
    jsonb_build_object(
      'previous_status', 'ready',
      'new_status', 'published',
      'publish_destinations', p_channels
    ),
    timezone('utc'::text, now())
  );

  -- 11. 인앱 알림 생성
  IF v_author_id IS NOT NULL THEN
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
      v_author_id,
      v_uid,
      p_article_id,
      'article_published',
      '기사 출고 완료',
      '"' || v_updated_article.title || '" 기사가 최종 출고되었습니다. (' || array_to_string(p_channels, ', ') || ')',
      false,
      timezone('utc'::text, now())
    );
  END IF;

  RETURN v_updated_article;
END;
$$;

-- 권한 부여
REVOKE EXECUTE ON FUNCTION public.request_article_review(UUID) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_article_review(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.request_article_changes(UUID, TEXT) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_article_changes(UUID, TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.resubmit_article_review(UUID, TEXT) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.resubmit_article_review(UUID, TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.approve_article(UUID) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_article(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.assign_article_and_deadline(UUID, UUID, TIMESTAMPTZ) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_article_and_deadline(UUID, UUID, TIMESTAMPTZ) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.publish_article(UUID, TEXT[]) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_article(UUID, TEXT[]) TO authenticated;
