-- PRESS-CMS: Fix block_type cast in restore_article_version
-- PostgreSQL enum 타입인 public.block_type으로 정확히 캐스팅하도록 수정합니다.

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

  -- 워크플로우 RPC 세션 플래그가 설정되어 있다면 통과 허용, 아니면 권한 확인
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
        (v_block_record->>'type')::public.block_type,
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
