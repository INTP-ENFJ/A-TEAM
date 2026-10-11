-- ========================================================
-- PRESS-CMS: Fix Article Version Ambiguous ID & Atomic Media Block Insert
-- 
-- 1. create_article_version 및 restore_article_version:
--    RETURNS TABLE(id UUID, ...)의 OUT 변수와 내부 SQL 컬럼의 'id' 충돌
--    (ERROR: column reference "id" is ambiguous)을 원천 해소하기 위해
--    #variable_conflict use_column 설정 및 모든 SQL 테이블에 명시적 alias 적용.
-- 
-- 2. insert_article_media_block:
--    미디어 라이브러리 카드를 본문 임의 위치(target_index)에 드롭 시
--    기존 블록의 position_index와 충돌(duplicate key value violates unique constraint)
--    하는 문제를 2단계 임시 음수 시프트 기법을 통해 원자적 트랜잭션으로 안전하게 삽입.
-- ========================================================

-- 1. create_article_version 재정의 (Ambiguous ID 해결)
CREATE OR REPLACE FUNCTION public.create_article_version(
  p_article_id UUID,
  p_summary TEXT DEFAULT '수동 버전 저장'
)
RETURNS TABLE (
  id UUID,
  article_id UUID,
  version_number INTEGER,
  title TEXT,
  subtitle TEXT,
  blocks_count INTEGER,
  char_count INTEGER,
  summary TEXT,
  created_by UUID,
  author_name TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_uid UUID := auth.uid();
  v_article RECORD;
  v_author_name TEXT;
  v_next_version INTEGER;
  v_blocks_json JSONB;
  v_b_count INTEGER := 0;
  v_c_count INTEGER := 0;
  v_snapshot JSONB;
  v_summary TEXT;
  v_new_id UUID;
  v_created_at TIMESTAMPTZ;
BEGIN
  -- 1. 인증 및 권한 검증
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '인증되지 않은 사용자입니다.';
  END IF;

  IF public.is_hr_admin(v_uid) THEN
    RAISE EXCEPTION '인사 관리자는 기사 버전을 생성할 수 없습니다.';
  END IF;

  -- [핵심 보강 1]: 기사 단위 Transaction Advisory Lock 획득 (트랜잭션 종료 시 자동 해제)
  PERFORM pg_advisory_xact_lock(hashtext('article_version_' || p_article_id::text));

  -- 2. 기사 및 프로젝트 소유권 검증 + 행 배타적 락(FOR UPDATE OF a) 획득
  SELECT a.*, pr.owner_id INTO v_article
  FROM public.articles a
  JOIN public.projects pr ON a.project_id = pr.id
  WHERE a.id = p_article_id
  FOR UPDATE OF a;

  IF NOT FOUND THEN
    RAISE EXCEPTION '대상 기사를 찾을 수 없습니다.';
  END IF;

  IF v_article.author_id != v_uid AND v_article.owner_id != v_uid THEN
    RAISE EXCEPTION '기사 버전을 생성할 권한이 없습니다.';
  END IF;

  -- 작성자 이름 조회 (alias p 명시 및 p.id 비교로 ambiguous id 원천 해소)
  SELECT COALESCE(p.name, '알 수 없음') INTO v_author_name
  FROM public.profiles p
  WHERE p.id = v_uid;

  -- 3. 다음 version_number 계산 (직렬화된 상태에서 안전하게 최신 최대값 + 1 계산)
  SELECT COALESCE(MAX(av.version_number), 0) + 1 INTO v_next_version
  FROM public.article_versions av
  WHERE av.article_id = p_article_id;

  -- 4. 기사의 전체 블록 상태 수집 (position_index ASC)
  SELECT 
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', b.id,
          'type', b.type,
          'position_index', b.position_index,
          'text', b.text,
          'media_url', b.media_url,
          'caption', b.caption,
          'credit', b.credit,
          'media_type', b.media_type,
          'file_format', b.file_format,
          'file_size', b.file_size
        ) ORDER BY b.position_index ASC
      ), 
      '[]'::jsonb
    ),
    COUNT(b.id),
    COALESCE(SUM(length(COALESCE(b.text, ''))), 0)
  INTO v_blocks_json, v_b_count, v_c_count
  FROM public.article_blocks b
  WHERE b.article_id = p_article_id;

  -- 글자수에 제목/부제 길이 합산
  v_c_count := v_c_count + length(COALESCE(v_article.title, '')) + length(COALESCE(v_article.subtitle, ''));

  -- 5. 스냅샷 데이터 조립
  v_snapshot := jsonb_build_object(
    'article', jsonb_build_object(
      'id', v_article.id,
      'title', v_article.title,
      'subtitle', v_article.subtitle,
      'category', v_article.category,
      'tags', v_article.tags,
      'status', v_article.status,
      'urgent', v_article.urgent,
      'exclusive', v_article.exclusive,
      'embargo', v_article.embargo,
      'publish_destinations', v_article.publish_destinations
    ),
    'blocks', v_blocks_json
  );

  v_summary := COALESCE(NULLIF(trim(p_summary), ''), '수동 버전 저장');

  -- 6. article_versions에 삽입
  INSERT INTO public.article_versions (
    article_id,
    version_number,
    title,
    subtitle,
    blocks_count,
    char_count,
    snapshot_data,
    summary,
    created_by
  )
  VALUES (
    p_article_id,
    v_next_version,
    v_article.title,
    v_article.subtitle,
    v_b_count,
    v_c_count,
    v_snapshot,
    v_summary,
    v_uid
  )
  RETURNING 
    article_versions.id, 
    article_versions.created_at 
  INTO v_new_id, v_created_at;

  -- 7. 결과 반환
  RETURN QUERY
  SELECT 
    v_new_id AS id,
    p_article_id AS article_id,
    v_next_version AS version_number,
    v_article.title AS title,
    v_article.subtitle AS subtitle,
    v_b_count AS blocks_count,
    v_c_count AS char_count,
    v_summary AS summary,
    v_uid AS created_by,
    v_author_name AS author_name,
    v_created_at AS created_at;
END;
$$;

ALTER FUNCTION public.create_article_version(UUID, TEXT) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.create_article_version(UUID, TEXT) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_article_version(UUID, TEXT) TO authenticated;


-- 2. restore_article_version 재정의 (Ambiguous ID 방어 강화)
CREATE OR REPLACE FUNCTION public.restore_article_version(p_version_id UUID)
RETURNS TABLE (
  success BOOLEAN,
  article_id UUID,
  restored_version_number INTEGER,
  backup_version_number INTEGER,
  new_version_number INTEGER
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_uid UUID := auth.uid();
  v_target RECORD;
  v_current_art RECORD;
  v_backup_version_num INTEGER;
  v_new_version_num INTEGER;
  v_current_blocks_json JSONB;
  v_cur_b_count INTEGER;
  v_cur_c_count INTEGER;
  v_cur_snapshot JSONB;
  v_target_art_json JSONB;
  v_target_blocks_json JSONB;
  v_block_record JSONB;
  v_now_iso TIMESTAMPTZ := timezone('utc'::text, now());
BEGIN
  -- 1. 인증 및 권한 검증
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '인증되지 않은 사용자입니다.';
  END IF;

  IF public.is_hr_admin(v_uid) THEN
    RAISE EXCEPTION '인사 관리자는 기사를 복원할 수 없습니다.';
  END IF;

  -- 2. 복원 대상 버전 조회 (명시적 alias av 사용)
  SELECT av.* INTO v_target
  FROM public.article_versions av
  WHERE av.id = p_version_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '복원할 대상 버전을 찾을 수 없습니다.';
  END IF;

  -- [핵심 보강 1]: 복원 대상 기사에 대한 Transaction Advisory Lock 획득
  PERFORM pg_advisory_xact_lock(hashtext('article_version_' || v_target.article_id::text));

  -- 3. 현재 기사 및 프로젝트 소유권 검증 + 행 배타적 락(FOR UPDATE OF a) 획득
  SELECT a.*, pr.owner_id INTO v_current_art
  FROM public.articles a
  JOIN public.projects pr ON a.project_id = pr.id
  WHERE a.id = v_target.article_id
  FOR UPDATE OF a;

  IF NOT FOUND THEN
    RAISE EXCEPTION '복원 대상 기사를 찾을 수 없습니다.';
  END IF;

  IF v_current_art.author_id != v_uid AND v_current_art.owner_id != v_uid THEN
    RAISE EXCEPTION '기사 복원 권한이 없습니다. 기사 작성자 또는 프로젝트 소유자만 복원할 수 있습니다.';
  END IF;

  -- [핵심 단계 A]: 복원 직전 현재 상태 자동 백업 (새 버전으로 저장)
  SELECT COALESCE(MAX(av.version_number), 0) + 1 INTO v_backup_version_num
  FROM public.article_versions av
  WHERE av.article_id = v_target.article_id;

  SELECT 
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', b.id,
          'type', b.type,
          'position_index', b.position_index,
          'text', b.text,
          'media_url', b.media_url,
          'caption', b.caption,
          'credit', b.credit,
          'media_type', b.media_type,
          'file_format', b.file_format,
          'file_size', b.file_size
        ) ORDER BY b.position_index ASC
      ), 
      '[]'::jsonb
    ),
    COUNT(b.id),
    COALESCE(SUM(length(COALESCE(b.text, ''))), 0)
  INTO v_current_blocks_json, v_cur_b_count, v_cur_c_count
  FROM public.article_blocks b
  WHERE b.article_id = v_target.article_id;

  v_cur_c_count := v_cur_c_count + length(COALESCE(v_current_art.title, '')) + length(COALESCE(v_current_art.subtitle, ''));

  v_cur_snapshot := jsonb_build_object(
    'article', jsonb_build_object(
      'id', v_current_art.id,
      'title', v_current_art.title,
      'subtitle', v_current_art.subtitle,
      'category', v_current_art.category,
      'tags', v_current_art.tags,
      'status', v_current_art.status,
      'urgent', v_current_art.urgent,
      'exclusive', v_current_art.exclusive,
      'embargo', v_current_art.embargo,
      'publish_destinations', v_current_art.publish_destinations
    ),
    'blocks', v_current_blocks_json
  );

  INSERT INTO public.article_versions (
    article_id,
    version_number,
    title,
    subtitle,
    blocks_count,
    char_count,
    snapshot_data,
    summary,
    created_by
  )
  VALUES (
    v_target.article_id,
    v_backup_version_num,
    v_current_art.title,
    v_current_art.subtitle,
    v_cur_b_count,
    v_cur_c_count,
    v_cur_snapshot,
    '복원 전 자동 백업 (v' || v_target.version_number || ' 복원 직전)',
    v_uid
  );

  -- [핵심 단계 B]: 대상 버전(v_target)의 스냅샷 데이터로 기사 상태 원자적 덮어쓰기
  v_target_art_json := v_target.snapshot_data->'article';
  v_target_blocks_json := v_target.snapshot_data->'blocks';

  UPDATE public.articles a
  SET 
    title = COALESCE(v_target_art_json->>'title', a.title),
    subtitle = v_target_art_json->>'subtitle',
    category = COALESCE(v_target_art_json->>'category', a.category),
    tags = CASE 
      WHEN v_target_art_json->'tags' IS NOT NULL 
      THEN ARRAY(SELECT jsonb_array_elements_text(v_target_art_json->'tags'))
      ELSE a.tags 
    END,
    urgent = COALESCE((v_target_art_json->>'urgent')::boolean, a.urgent),
    exclusive = COALESCE((v_target_art_json->>'exclusive')::boolean, a.exclusive),
    updated_at = v_now_iso
  WHERE a.id = v_target.article_id;

  -- 기존 블록 일괄 삭제 후 스냅샷 블록 복원
  DELETE FROM public.article_blocks b
  WHERE b.article_id = v_target.article_id;

  IF v_target_blocks_json IS NOT NULL AND jsonb_array_length(v_target_blocks_json) > 0 THEN
    FOR v_block_record IN SELECT * FROM jsonb_array_elements(v_target_blocks_json)
    LOOP
      INSERT INTO public.article_blocks (
        id,
        article_id,
        type,
        position_index,
        text,
        media_url,
        caption,
        credit,
        media_type,
        file_format,
        file_size,
        created_at,
        updated_at
      )
      VALUES (
        gen_random_uuid(),
        v_target.article_id,
        (v_block_record->>'type')::public.article_block_type,
        COALESCE((v_block_record->>'position_index')::integer, 0),
        v_block_record->>'text',
        v_block_record->>'media_url',
        v_block_record->>'caption',
        v_block_record->>'credit',
        v_block_record->>'media_type',
        v_block_record->>'file_format',
        (v_block_record->>'file_size')::bigint,
        v_now_iso,
        v_now_iso
      );
    END LOOP;
  END IF;

  -- [핵심 단계 C]: 복원 완료를 증명하는 신규 버전 기록 생성
  v_new_version_num := v_backup_version_num + 1;

  INSERT INTO public.article_versions (
    article_id,
    version_number,
    title,
    subtitle,
    blocks_count,
    char_count,
    snapshot_data,
    summary,
    created_by
  )
  VALUES (
    v_target.article_id,
    v_new_version_num,
    v_target.title,
    v_target.subtitle,
    v_target.blocks_count,
    v_target.char_count,
    v_target.snapshot_data,
    'v' || v_target.version_number || ' 상태로 복원됨',
    v_uid
  );

  RETURN QUERY
  SELECT 
    true AS success,
    v_target.article_id AS article_id,
    v_target.version_number AS restored_version_number,
    v_backup_version_num AS backup_version_number,
    v_new_version_num AS new_version_number;
END;
$$;

ALTER FUNCTION public.restore_article_version(UUID) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.restore_article_version(UUID) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.restore_article_version(UUID) TO authenticated;


-- 3. 신규 RPC: insert_article_media_block
--    임의의 target_index 위치에 미디어 블록을 UNIQUE 충돌 없이 원자적으로 삽입합니다.
CREATE OR REPLACE FUNCTION public.insert_article_media_block(
  p_article_id UUID,
  p_target_index INTEGER,
  p_type TEXT,
  p_media_url TEXT,
  p_caption TEXT DEFAULT NULL,
  p_credit TEXT DEFAULT NULL,
  p_media_type TEXT DEFAULT NULL,
  p_file_format TEXT DEFAULT NULL,
  p_file_size BIGINT DEFAULT NULL
)
RETURNS public.article_blocks
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_uid UUID := auth.uid();
  v_new_block public.article_blocks;
  v_max_pos INTEGER;
  v_target INTEGER;
  v_now_iso TIMESTAMPTZ := timezone('utc'::text, now());
BEGIN
  -- 1. 인증 및 권한 검증
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '인증되지 않은 사용자입니다.';
  END IF;

  IF public.is_hr_admin(v_uid) THEN
    RAISE EXCEPTION '인사 관리자는 기사 본문을 편집할 수 없습니다.';
  END IF;

  -- 2. 동시성 제어: 대상 기사 row lock
  PERFORM 1 
  FROM public.articles a 
  WHERE a.id = p_article_id 
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '대상 기사를 찾을 수 없습니다.';
  END IF;

  -- 3. 현재 최대 position_index 확인
  SELECT COALESCE(MAX(b.position_index), -1) INTO v_max_pos
  FROM public.article_blocks b
  WHERE b.article_id = p_article_id;

  -- 4. target_index 유효 범위 보정 (0 ~ v_max_pos + 1)
  IF p_target_index < 0 THEN
    v_target := 0;
  ELSIF p_target_index > v_max_pos + 1 THEN
    v_target := v_max_pos + 1;
  ELSE
    v_target := p_target_index;
  END IF;

  -- 5. 기존 블록들 중 target_index 이상인 블록들의 position_index를 1씩 뒤로 안전하게 shift
  -- (UNIQUE constraint 위반 방지를 위해 2단계 음수 시프트 적용)
  UPDATE public.article_blocks b
  SET position_index = -(b.position_index + 1000000)
  WHERE b.article_id = p_article_id AND b.position_index >= v_target;

  UPDATE public.article_blocks b
  SET position_index = (-b.position_index) - 1000000 + 1,
      updated_at = v_now_iso
  WHERE b.article_id = p_article_id AND b.position_index <= -1000000;

  -- 6. 비어있는 v_target 위치에 신규 블록 원자적 INSERT
  INSERT INTO public.article_blocks (
    article_id,
    position_index,
    type,
    text,
    media_url,
    caption,
    credit,
    media_type,
    file_format,
    file_size,
    created_at,
    updated_at
  ) VALUES (
    p_article_id,
    v_target,
    COALESCE(p_type, 'image')::public.block_type,
    '',
    p_media_url,
    p_caption,
    p_credit,
    p_media_type,
    p_file_format,
    p_file_size,
    v_now_iso,
    v_now_iso
  )
  RETURNING * INTO v_new_block;

  -- 7. 기사 수정 시간 갱신
  UPDATE public.articles a
  SET updated_at = v_now_iso
  WHERE a.id = p_article_id;

  RETURN v_new_block;
END;
$$;

ALTER FUNCTION public.insert_article_media_block(UUID, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.insert_article_media_block(UUID, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.insert_article_media_block(UUID, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT) TO authenticated;
