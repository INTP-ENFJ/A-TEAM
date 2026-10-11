-- ========================================================
-- PRESS-CMS: Article Assignment & Deadline Migration
-- ========================================================
-- 1. articles 테이블에 deadline_at 컬럼 추가
-- 2. 마감시간 인덱스 생성
-- 3. notifications 테이블 type CHECK 제약조건 확장
-- 4. 동일 부서 기자 목록 조회 RPC (get_department_reporters)
-- 5. 기사 배정 및 마감 설정 전용 RPC (assign_article)

-- 1. articles 테이블에 deadline_at 컬럼 추가
ALTER TABLE public.articles 
ADD COLUMN IF NOT EXISTS deadline_at TIMESTAMPTZ NULL;

-- 2. 마감시간 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_articles_deadline 
ON public.articles (deadline_at);

-- 3. notifications 테이블 type 제약조건 확장 (article_assigned, deadline_changed 추가)
ALTER TABLE public.notifications 
DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications 
ADD CONSTRAINT notifications_type_check CHECK (
  type IN (
    'review_requested',
    'changes_requested',
    'review_resubmitted',
    'article_approved',
    'article_published',
    'article_assigned',
    'deadline_changed'
  )
);

-- 4. RPC: get_department_reporters
-- 데스크 사용자가 동일한 부서 소속 기자 목록을 조회할 수 있도록 지원
CREATE OR REPLACE FUNCTION public.get_department_reporters()
RETURNS TABLE (
  id UUID,
  name TEXT,
  rank TEXT,
  role TEXT,
  department TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_reviewer RECORD;
BEGIN
  -- 1. 인증 확인
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '인증되지 않은 사용자입니다.';
  END IF;

  -- 2. 데스크 권한 검증
  SELECT id, rank, role, department_id INTO v_reviewer
  FROM public.profiles
  WHERE id = v_uid;

  IF NOT (
    v_reviewer.rank IN ('manager'::public.user_rank, 'deputy'::public.user_rank)
    OR v_reviewer.role IN ('desk_editor'::public.user_role, 'editor_in_chief'::public.user_role)
  ) THEN
    RAISE EXCEPTION '데스크(부장/차장 또는 데스크 에디터)만 부서 기자 목록을 조회할 수 있습니다.';
  END IF;

  IF v_reviewer.department_id IS NULL THEN
    RAISE EXCEPTION '소속 부서 정보가 없는 사용자는 기자 목록을 조회할 수 없습니다.';
  END IF;

  -- 3. 동일 부서 직원 목록 반환
  RETURN QUERY
  SELECT
    p.id,
    p.name,
    p.rank::TEXT,
    p.role::TEXT,
    p.department
  FROM public.profiles p
  WHERE p.department_id = v_reviewer.department_id
  ORDER BY p.name ASC;
END;
$$;

-- 5. RPC: assign_article
-- 데스크가 동일 부서 기자에게 기사를 배정하고 마감시간을 지정
CREATE OR REPLACE FUNCTION public.assign_article(
  p_article_id UUID,
  p_author_id UUID,
  p_deadline_at TIMESTAMPTZ
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
  v_new_author RECORD;
  v_prev_author_id UUID;
  v_prev_deadline TIMESTAMPTZ;
  v_author_changed BOOLEAN := false;
  v_deadline_changed BOOLEAN := false;
  v_updated public.articles;
BEGIN
  -- 1. 인증 확인
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '인증되지 않은 사용자입니다.';
  END IF;

  IF public.is_hr_admin(v_uid) THEN
    RAISE EXCEPTION '인사 관리자는 기사를 배정하거나 마감시간을 변경할 수 없습니다.';
  END IF;

  -- 2. 데스크 권한 확인
  SELECT id, name, rank, role, department_id INTO v_reviewer
  FROM public.profiles
  WHERE id = v_uid;

  IF NOT (
    v_reviewer.rank IN ('manager'::public.user_rank, 'deputy'::public.user_rank)
    OR v_reviewer.role IN ('desk_editor'::public.user_role, 'editor_in_chief'::public.user_role)
  ) THEN
    RAISE EXCEPTION '기사 배정 및 마감시간 변경은 데스크만 가능합니다.';
  END IF;

  -- 3. 대상 기사 lock 및 존재 확인
  SELECT * INTO v_article
  FROM public.articles
  WHERE id = p_article_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '대상 기사를 찾을 수 없습니다.';
  END IF;

  -- 4. 대상 기자 확인 및 동일 부서 검증
  SELECT id, name, department_id INTO v_new_author
  FROM public.profiles
  WHERE id = p_author_id;

  IF v_new_author.id IS NULL THEN
    RAISE EXCEPTION '배정 대상 기자를 찾을 수 없습니다.';
  END IF;

  IF v_new_author.department_id IS NULL OR v_reviewer.department_id IS NULL OR v_new_author.department_id != v_reviewer.department_id THEN
    RAISE EXCEPTION '동일한 부서 소속 기자에게만 기사를 배정할 수 있습니다.';
  END IF;

  v_prev_author_id := v_article.author_id;
  v_prev_deadline := v_article.deadline_at;

  IF v_prev_author_id != p_author_id THEN
    v_author_changed := true;
  END IF;

  IF (v_prev_deadline IS NULL AND p_deadline_at IS NOT NULL)
     OR (v_prev_deadline IS NOT NULL AND p_deadline_at IS NULL)
     OR (v_prev_deadline IS NOT NULL AND p_deadline_at IS NOT NULL AND v_prev_deadline != p_deadline_at) THEN
    v_deadline_changed := true;
  END IF;

  -- 5. 기사 업데이트
  UPDATE public.articles
  SET
    author_id = p_author_id,
    deadline_at = p_deadline_at,
    updated_at = timezone('utc'::text, now())
  WHERE id = p_article_id
  RETURNING * INTO v_updated;

  -- projects 테이블의 deadline 동기화 (존재 시)
  UPDATE public.projects
  SET 
    deadline = CASE 
      WHEN p_deadline_at IS NOT NULL THEN to_char(p_deadline_at, 'YYYY-MM-DD HH24:MI')
      ELSE NULL 
    END,
    updated_at = timezone('utc'::text, now())
  WHERE id = v_article.project_id;

  -- 6. 알림 생성
  -- 새 기자 배정 알림
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
      '새 기사 배정',
      COALESCE(v_reviewer.name, '데스크') || ' 데스크가 "' || v_article.title || '" 기사를 배정했습니다.',
      false,
      timezone('utc'::text, now())
    );
  END IF;

  -- 마감시간 변경 알림 (배정 알림과 중복되지 않게 기자가 변경되지 않은 상태에서 마감만 변경된 경우)
  IF v_deadline_changed AND NOT v_author_changed AND p_author_id != v_uid THEN
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
      'deadline_changed',
      '마감시간 변경',
      '"' || v_article.title || '" 기사의 마감시간이 설정/변경되었습니다.',
      false,
      timezone('utc'::text, now())
    );
  END IF;

  RETURN v_updated;
END;
$$;
