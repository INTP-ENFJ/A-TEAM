-- ========================================================
-- PRESS-CMS: Core CRUD용 원자적 DB RPC 3종 마이그레이션
-- ========================================================

-- 1. create_project_with_initial_article RPC
CREATE OR REPLACE FUNCTION public.create_project_with_initial_article(
  p_name TEXT,
  p_article_title TEXT,
  p_category TEXT DEFAULT '정치',
  p_coverage_type TEXT DEFAULT '기획취재',
  p_deadline TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  project_id UUID,
  article_id UUID,
  initial_block_id UUID
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_trimmed_name TEXT;
  v_trimmed_title TEXT;
  v_new_project_id UUID;
  v_new_article_id UUID;
  v_new_block_id UUID;
BEGIN
  -- 1. 인증 및 인가 검증
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '인증되지 않은 사용자입니다.';
  END IF;

  IF public.is_hr_admin(v_uid) THEN
    RAISE EXCEPTION '인사 관리자는 뉴스룸 프로젝트를 생성할 수 없습니다.';
  END IF;

  -- 2. 파라미터 유효성 검증
  v_trimmed_name := trim(p_name);
  v_trimmed_title := trim(p_article_title);

  IF v_trimmed_name IS NULL OR length(v_trimmed_name) = 0 THEN
    RAISE EXCEPTION '프로젝트명은 필수 입력 항목입니다.';
  END IF;

  IF v_trimmed_title IS NULL OR length(v_trimmed_title) = 0 THEN
    RAISE EXCEPTION '기사 제목은 필수 입력 항목입니다.';
  END IF;

  -- 3. 프로젝트 생성 (projects)
  INSERT INTO public.projects (
    owner_id,
    name,
    article_title,
    visibility,
    coverage_type,
    deadline
  )
  VALUES (
    v_uid,
    v_trimmed_name,
    v_trimmed_title,
    'private'::public.project_visibility,
    p_coverage_type,
    p_deadline
  )
  RETURNING id INTO v_new_project_id;

  -- 4. 기사 생성 (articles)
  INSERT INTO public.articles (
    project_id,
    author_id,
    title,
    subtitle,
    category,
    tags,
    status,
    urgent,
    exclusive,
    publish_destinations
  )
  VALUES (
    v_new_project_id,
    v_uid,
    v_trimmed_title,
    '',
    COALESCE(p_category, '정치'),
    ARRAY[]::TEXT[],
    'draft'::public.article_status,
    false,
    false,
    ARRAY[]::TEXT[]
  )
  RETURNING id INTO v_new_article_id;

  -- 5. 최초 문단 블록 생성 (article_blocks)
  INSERT INTO public.article_blocks (
    article_id,
    position_index,
    type,
    text
  )
  VALUES (
    v_new_article_id,
    0,
    'paragraph'::public.block_type,
    ''
  )
  RETURNING id INTO v_new_block_id;

  -- 6. 결과 반환
  project_id := v_new_project_id;
  article_id := v_new_article_id;
  initial_block_id := v_new_block_id;
  RETURN NEXT;
END;
$$;

ALTER FUNCTION public.create_project_with_initial_article(TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.create_project_with_initial_article(TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_project_with_initial_article(TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ) TO authenticated;


-- 2. reorder_article_blocks RPC
CREATE OR REPLACE FUNCTION public.reorder_article_blocks(
  p_article_id UUID,
  p_block_ids UUID[]
)
RETURNS SETOF public.article_blocks
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_current_count INTEGER;
  v_param_count INTEGER;
  v_distinct_count INTEGER;
  v_foreign_count INTEGER;
BEGIN
  -- 1. 인증 및 인가 검증
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '인증되지 않은 사용자입니다.';
  END IF;

  IF public.is_hr_admin(v_uid) THEN
    RAISE EXCEPTION '인사 관리자는 기사 본문을 수정할 수 없습니다.';
  END IF;

  -- 2. 기사 소유권 확인 (프로젝트 소유자 본인만 블록 순서 변경 가능)
  IF NOT EXISTS (
    SELECT 1 
    FROM public.projects p 
    JOIN public.articles a ON a.project_id = p.id 
    WHERE a.id = p_article_id AND p.owner_id = v_uid
  ) THEN
    RAISE EXCEPTION '기사 본문을 수정할 권한이 없습니다.';
  END IF;

  -- 3. 동시성 제어: 대상 기사 row lock
  PERFORM 1 FROM public.articles WHERE id = p_article_id FOR UPDATE;

  -- 4. 파라미터 유효성 검증
  IF p_block_ids IS NULL OR cardinality(p_block_ids) = 0 THEN
    RAISE EXCEPTION '블록 ID 배열이 비어 있습니다.';
  END IF;

  v_param_count := cardinality(p_block_ids);

  -- 중복 ID 검증
  SELECT count(DISTINCT id) INTO v_distinct_count FROM unnest(p_block_ids) AS id;
  IF v_distinct_count != v_param_count THEN
    RAISE EXCEPTION '중복된 블록 ID가 포함되어 있습니다.';
  END IF;

  -- 해당 기사의 실제 전체 블록 수 확인
  SELECT count(*) INTO v_current_count FROM public.article_blocks WHERE article_id = p_article_id;
  IF v_param_count != v_current_count THEN
    RAISE EXCEPTION '전달된 블록 개수(%)가 현재 기사의 총 블록 수(%)와 일치하지 않습니다.', v_param_count, v_current_count;
  END IF;

  -- 타 기사 블록 또는 미존재 블록 혼입 검증
  SELECT count(*) INTO v_foreign_count
  FROM unnest(p_block_ids) AS id
  WHERE id NOT IN (SELECT b.id FROM public.article_blocks b WHERE b.article_id = p_article_id);

  IF v_foreign_count > 0 THEN
    RAISE EXCEPTION '해당 기사에 속하지 않는 잘못된 블록 ID가 포함되어 있습니다.';
  END IF;

  -- 5. UNIQUE 충돌 방지 2단계 원자적 UPDATE
  -- 1단계: 임시 음수 인덱스 부여
  UPDATE public.article_blocks b
  SET position_index = -(mapped.ord)
  FROM (
    SELECT id, ord 
    FROM unnest(p_block_ids) WITH ORDINALITY AS t(id, ord)
  ) mapped
  WHERE b.id = mapped.id AND b.article_id = p_article_id;

  -- 2단계: 최종 0-based 인덱스 부여 및 타임스탬프 갱신
  UPDATE public.article_blocks b
  SET position_index = (mapped.ord - 1),
      updated_at = now()
  FROM (
    SELECT id, ord 
    FROM unnest(p_block_ids) WITH ORDINALITY AS t(id, ord)
  ) mapped
  WHERE b.id = mapped.id AND b.article_id = p_article_id;

  -- 6. 정렬된 결과 반환
  RETURN QUERY
  SELECT * FROM public.article_blocks
  WHERE article_id = p_article_id
  ORDER BY position_index ASC;
END;
$$;

ALTER FUNCTION public.reorder_article_blocks(UUID, UUID[]) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.reorder_article_blocks(UUID, UUID[]) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.reorder_article_blocks(UUID, UUID[]) TO authenticated;


-- 3. import_article_blocks RPC
CREATE OR REPLACE FUNCTION public.import_article_blocks(
  p_article_id UUID,
  p_mode TEXT,
  p_paragraphs TEXT[]
)
RETURNS SETOF public.article_blocks
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_base_index INTEGER := 0;
  v_valid_count INTEGER;
BEGIN
  -- 1. 인증 및 인가 검증
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '인증되지 않은 사용자입니다.';
  END IF;

  IF public.is_hr_admin(v_uid) THEN
    RAISE EXCEPTION '인사 관리자는 기사 본문을 수정할 수 없습니다.';
  END IF;

  -- 2. 기사 소유권 확인 (프로젝트 소유자 본인만 블록 임포트 가능)
  IF NOT EXISTS (
    SELECT 1 
    FROM public.projects p 
    JOIN public.articles a ON a.project_id = p.id 
    WHERE a.id = p_article_id AND p.owner_id = v_uid
  ) THEN
    RAISE EXCEPTION '기사 본문을 수정할 권한이 없습니다.';
  END IF;

  -- 3. 모드 검증
  IF p_mode NOT IN ('replace', 'append') THEN
    RAISE EXCEPTION '유효하지 않은 임포트 모드입니다: %. (replace 또는 append만 허용)', p_mode;
  END IF;

  -- 4. 문단 배열 검증
  IF p_paragraphs IS NULL OR cardinality(p_paragraphs) = 0 THEN
    RAISE EXCEPTION '가져올 텍스트 문단이 없습니다.';
  END IF;

  IF cardinality(p_paragraphs) > 500 THEN
    RAISE EXCEPTION '1회 가져오기 가능한 최대 문단 수는 500개입니다. (현재: %개)', cardinality(p_paragraphs);
  END IF;

  -- 공백 제외 유효 문단 존재 확인
  SELECT count(*) INTO v_valid_count
  FROM unnest(p_paragraphs) AS p
  WHERE length(trim(p)) > 0;

  IF v_valid_count = 0 THEN
    RAISE EXCEPTION '유효한 본문 내용이 포함된 문단이 없습니다.';
  END IF;

  -- 5. 동시성 제어: 대상 기사 row lock
  PERFORM 1 FROM public.articles WHERE id = p_article_id FOR UPDATE;

  -- 6. 모드별 기준 인덱스 및 기존 블록 처리
  IF p_mode = 'replace' THEN
    DELETE FROM public.article_blocks WHERE article_id = p_article_id;
    v_base_index := 0;
  ELSE
    SELECT COALESCE(MAX(position_index) + 1, 0) INTO v_base_index
    FROM public.article_blocks
    WHERE article_id = p_article_id;
  END IF;

  -- 7. 연속적인 인덱스 부여 및 일괄 INSERT
  RETURN QUERY
  WITH cleaned AS (
    SELECT trim(elem) AS txt
    FROM unnest(p_paragraphs) AS elem
    WHERE length(trim(elem)) > 0
  ), numbered AS (
    SELECT 
      txt,
      (ROW_NUMBER() OVER () - 1)::integer AS idx
    FROM cleaned
  )
  INSERT INTO public.article_blocks (
    article_id,
    position_index,
    type,
    text
  )
  SELECT 
    p_article_id,
    v_base_index + idx,
    'paragraph'::public.block_type,
    txt
  FROM numbered
  RETURNING *;
END;
$$;

ALTER FUNCTION public.import_article_blocks(UUID, TEXT, TEXT[]) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.import_article_blocks(UUID, TEXT, TEXT[]) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_article_blocks(UUID, TEXT, TEXT[]) TO authenticated;
