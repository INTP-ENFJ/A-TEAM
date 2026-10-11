-- 20261007153000_split_article_text_and_insert_media.sql
-- PRESS-CMS: 본문 글자 중간 미디어 삽입 시 텍스트 분할 및 미디어 원자적 삽입 RPC

CREATE OR REPLACE FUNCTION public.split_article_text_and_insert_media(
  p_article_id UUID,
  p_split_block_id UUID,
  p_text_before TEXT,
  p_text_after TEXT,
  p_media_type TEXT,
  p_media_url TEXT,
  p_caption TEXT DEFAULT NULL,
  p_credit TEXT DEFAULT NULL,
  p_file_format TEXT DEFAULT NULL,
  p_file_size BIGINT DEFAULT NULL,
  p_obsolete_block_ids UUID[] DEFAULT '{}'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_uid UUID := auth.uid();
  v_pos INTEGER;
  v_target_split_id UUID := p_split_block_id;
  v_media_block public.article_blocks;
  v_after_block public.article_blocks;
  v_now_iso TIMESTAMPTZ := timezone('utc'::text, now());
BEGIN
  -- 1. 인증 및 권한 검증
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '인증되지 않은 사용자입니다.';
  END IF;

  IF public.is_hr_admin(v_uid) THEN
    RAISE EXCEPTION '인사 관리자는 기사 본문을 편집할 수 없습니다.';
  END IF;

  -- 2. 대상 기사 배타적 행 잠금 (동시성 제어)
  PERFORM 1 
  FROM public.articles a 
  WHERE a.id = p_article_id 
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '대상 기사를 찾을 수 없습니다.';
  END IF;

  -- 3. 분할 기준 블록의 존재 여부 및 position_index 조회
  SELECT b.position_index INTO v_pos
  FROM public.article_blocks b
  WHERE b.id = v_target_split_id AND b.article_id = p_article_id;

  IF v_pos IS NULL THEN
    -- 기존 블록이 없거나 임시 ID인 경우 최대 position_index 다음 위치로 지정 후 생성
    SELECT COALESCE(MAX(b.position_index) + 1, 0) INTO v_pos
    FROM public.article_blocks b
    WHERE b.article_id = p_article_id;

    INSERT INTO public.article_blocks (
      article_id,
      position_index,
      type,
      text,
      created_at,
      updated_at
    ) VALUES (
      p_article_id,
      v_pos,
      'paragraph'::public.block_type,
      p_text_before,
      v_now_iso,
      v_now_iso
    )
    RETURNING id INTO v_target_split_id;
  ELSE
    -- 기존 블록을 앞쪽 텍스트(p_text_before)로 즉시 갱신
    UPDATE public.article_blocks b
    SET text = p_text_before,
        type = 'paragraph'::public.block_type,
        updated_at = v_now_iso
    WHERE b.id = v_target_split_id AND b.article_id = p_article_id;
  END IF;

  -- 4. 불필요해진 구 블록들 삭제 (기준 블록 제외)
  IF p_obsolete_block_ids IS NOT NULL AND array_length(p_obsolete_block_ids, 1) > 0 THEN
    DELETE FROM public.article_blocks
    WHERE article_id = p_article_id 
      AND id = ANY(p_obsolete_block_ids)
      AND id <> v_target_split_id;
  END IF;

  -- 5. 기준 블록 뒤(> v_pos)에 있는 모든 블록들의 position_index를 2씩 뒤로 안전하게 shift
  -- (UNIQUE constraint 위반 방지를 위해 2단계 음수 시프트 적용)
  UPDATE public.article_blocks b
  SET position_index = -(b.position_index + 1000000)
  WHERE b.article_id = p_article_id AND b.position_index > v_pos;

  UPDATE public.article_blocks b
  SET position_index = (-b.position_index) - 1000000 + 2,
      updated_at = v_now_iso
  WHERE b.article_id = p_article_id AND b.position_index <= -1000000;

  -- 6. v_pos + 1 위치에 미디어 블록 원자적 삽입
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
    v_pos + 1,
    COALESCE(p_media_type, 'image')::public.block_type,
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
  RETURNING * INTO v_media_block;

  -- 7. v_pos + 2 위치에 뒤쪽 텍스트 문단 블록 원자적 삽입
  INSERT INTO public.article_blocks (
    article_id,
    position_index,
    type,
    text,
    created_at,
    updated_at
  ) VALUES (
    p_article_id,
    v_pos + 2,
    'paragraph'::public.block_type,
    p_text_after,
    v_now_iso,
    v_now_iso
  )
  RETURNING * INTO v_after_block;

  -- 8. 기사 수정 시간 갱신
  UPDATE public.articles a
  SET updated_at = v_now_iso
  WHERE a.id = p_article_id;

  -- 9. 결과 JSON 반환
  RETURN jsonb_build_object(
    'success', true,
    'split_block_id', v_target_split_id,
    'media_block_id', v_media_block.id,
    'after_block_id', v_after_block.id
  );
END;
$$;

ALTER FUNCTION public.split_article_text_and_insert_media(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, UUID[]) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.split_article_text_and_insert_media(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, UUID[]) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.split_article_text_and_insert_media(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, UUID[]) TO authenticated;
