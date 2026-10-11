-- ========================================================
-- PRESS-CMS: Article Versions Table & RPCs Migration
-- ========================================================
-- 기사 버전 이력(Version History)을 영속화하고,
-- 원자적 버전 생성, 조회, 복원(Restore) 및 복원 직전 자동 백업을 지원합니다.

-- 1. article_versions 테이블 생성
CREATE TABLE IF NOT EXISTS public.article_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id UUID NOT NULL REFERENCES public.articles(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  subtitle TEXT,
  blocks_count INTEGER NOT NULL DEFAULT 0,
  char_count INTEGER NOT NULL DEFAULT 0,
  snapshot_data JSONB NOT NULL,
  summary TEXT NOT NULL DEFAULT '수동 버전 저장',
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT uq_article_versions_article_version UNIQUE (article_id, version_number)
);

-- 코멘트 추가
COMMENT ON TABLE public.article_versions IS '기사 버전 히스토리 및 본문/메타데이터 스냅샷 저장소';
COMMENT ON COLUMN public.article_versions.version_number IS '기사별 순차 버전 번호 (v1, v2, ...)';
COMMENT ON COLUMN public.article_versions.snapshot_data IS '해당 시점의 기사 메타데이터 및 전체 blocks JSONB 배열';
COMMENT ON COLUMN public.article_versions.summary IS '버전 생성 사유 및 변경 요약';

-- 2. 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_article_versions_article_id_ver 
  ON public.article_versions (article_id, version_number DESC);

CREATE INDEX IF NOT EXISTS idx_article_versions_created_by 
  ON public.article_versions (created_by);

-- 3. RLS 활성화 및 정책 정의
ALTER TABLE public.article_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read accessible article versions" ON public.article_versions;
CREATE POLICY "Users can read accessible article versions" ON public.article_versions
FOR SELECT TO authenticated
USING (
  NOT public.is_hr_admin(auth.uid())
  AND public.can_access_article_block(article_id, auth.uid())
);

DROP POLICY IF EXISTS "Users can insert article versions" ON public.article_versions;
CREATE POLICY "Users can insert article versions" ON public.article_versions
FOR INSERT TO authenticated
WITH CHECK (
  NOT public.is_hr_admin(auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.projects p
    JOIN public.articles a ON a.project_id = p.id
    WHERE a.id = article_id 
      AND (p.owner_id = auth.uid() OR a.author_id = auth.uid())
  )
);

-- 4. RPC: get_article_versions
-- 기사의 버전 목록을 작성자 프로필 이름과 함께 조회 (version_number DESC)
CREATE OR REPLACE FUNCTION public.get_article_versions(p_article_id UUID)
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
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '인증되지 않은 사용자입니다.';
  END IF;

  IF public.is_hr_admin(v_uid) THEN
    RAISE EXCEPTION '인사 관리자는 기사 수정 이력에 접근할 수 없습니다.';
  END IF;

  IF NOT public.can_access_article_block(p_article_id, v_uid) THEN
    RAISE EXCEPTION '해당 기사의 버전 이력을 조회할 권한이 없습니다.';
  END IF;

  RETURN QUERY
  SELECT 
    v.id,
    v.article_id,
    v.version_number,
    v.title,
    v.subtitle,
    v.blocks_count,
    v.char_count,
    v.summary,
    v.created_by,
    COALESCE(p.name, '알 수 없음') AS author_name,
    v.created_at
  FROM public.article_versions v
  LEFT JOIN public.profiles p ON p.id = v.created_by
  WHERE v.article_id = p_article_id
  ORDER BY v.version_number DESC;
END;
$$;

-- 5. RPC: create_article_version
-- 현재 기사의 메타데이터와 전체 블록을 원자적으로 조회하여 새 스냅샷 버전으로 기록
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

  -- 2. 기사 및 프로젝트 소유권 검증 (기사 작성자 또는 프로젝트 소유자 본인만 가능)
  SELECT a.*, p.owner_id INTO v_article
  FROM public.articles a
  JOIN public.projects p ON a.project_id = p.id
  WHERE a.id = p_article_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '대상 기사를 찾을 수 없습니다.';
  END IF;

  IF v_article.author_id != v_uid AND v_article.owner_id != v_uid THEN
    RAISE EXCEPTION '기사 버전을 생성할 권한이 없습니다.';
  END IF;

  -- 작성자 이름 조회
  SELECT COALESCE(name, '알 수 없음') INTO v_author_name
  FROM public.profiles
  WHERE id = v_uid;

  -- 3. 다음 version_number 계산 (원자적 계산)
  SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_next_version
  FROM public.article_versions
  WHERE article_versions.article_id = p_article_id;

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
    v_new_id,
    p_article_id,
    v_next_version,
    v_article.title,
    v_article.subtitle,
    v_b_count,
    v_c_count,
    v_summary,
    v_uid,
    v_author_name,
    v_created_at;
END;
$$;

-- 6. RPC: restore_article_version
-- 복원 원칙:
-- 1) 복원 직전 현재 상태를 자동으로 Snapshot 저장 ('vN 복원 직전 자동 백업')
-- 2) 대상 버전의 snapshot_data로 articles 및 article_blocks 원자적 복원
-- 3) 복원 완료에 대한 새로운 Version 기록 ('vN 버전으로 복원됨')
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

  -- 2. 복원 대상 버전 조회
  SELECT * INTO v_target
  FROM public.article_versions
  WHERE id = p_version_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '복원할 대상 버전을 찾을 수 없습니다.';
  END IF;

  -- 3. 현재 기사 및 프로젝트 소유권 검증
  SELECT a.*, p.owner_id INTO v_current_art
  FROM public.articles a
  JOIN public.projects p ON a.project_id = p.id
  WHERE a.id = v_target.article_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '복원 대상 기사를 찾을 수 없습니다.';
  END IF;

  IF v_current_art.author_id != v_uid AND v_current_art.owner_id != v_uid THEN
    RAISE EXCEPTION '기사 복원 권한이 없습니다. 기사 작성자 또는 프로젝트 소유자만 복원할 수 있습니다.';
  END IF;

  -- ========================================================
  -- [핵심 단계 A]: 복원 직전 현재 상태 자동 백업 (새 버전으로 저장)
  -- ========================================================
  SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_backup_version_num
  FROM public.article_versions
  WHERE article_versions.article_id = v_target.article_id;

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
    created_by,
    created_at
  )
  VALUES (
    v_target.article_id,
    v_backup_version_num,
    v_current_art.title,
    v_current_art.subtitle,
    v_cur_b_count,
    v_cur_c_count,
    v_cur_snapshot,
    'v' || v_target.version_number || ' 복원 직전 자동 백업',
    v_uid,
    v_now_iso
  );

  -- ========================================================
  -- [핵심 단계 B]: 대상 버전 snapshot_data로 articles 및 article_blocks 원자적 복원
  -- ========================================================
  v_target_art_json := v_target.snapshot_data -> 'article';
  v_target_blocks_json := v_target.snapshot_data -> 'blocks';

  -- B-1: articles 메타데이터 복원
  UPDATE public.articles
  SET 
    title = COALESCE(v_target_art_json ->> 'title', title),
    subtitle = v_target_art_json ->> 'subtitle',
    category = v_target_art_json ->> 'category',
    tags = ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_target_art_json -> 'tags', '[]'::jsonb))),
    urgent = COALESCE((v_target_art_json ->> 'urgent')::boolean, urgent),
    exclusive = COALESCE((v_target_art_json ->> 'exclusive')::boolean, exclusive),
    updated_at = v_now_iso
  WHERE id = v_target.article_id;

  -- projects 테이블의 article_title 및 updated_at 동기화
  UPDATE public.projects
  SET 
    article_title = COALESCE(v_target_art_json ->> 'title', article_title),
    updated_at = v_now_iso
  WHERE id = v_current_art.project_id;

  -- B-2: 기존 article_blocks 삭제 후 스냅샷 블록 재구성
  DELETE FROM public.article_blocks
  WHERE article_id = v_target.article_id;

  -- B-3: 스냅샷의 블록들을 일괄 삽입
  IF v_target_blocks_json IS NOT NULL AND jsonb_array_length(v_target_blocks_json) > 0 THEN
    FOR v_block_record IN SELECT * FROM jsonb_array_elements(v_target_blocks_json)
    LOOP
      INSERT INTO public.article_blocks (
        id,
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
      )
      VALUES (
        COALESCE(NULLIF(v_block_record ->> 'id', '')::uuid, gen_random_uuid()),
        v_target.article_id,
        COALESCE((v_block_record ->> 'position_index')::integer, 0),
        COALESCE((v_block_record ->> 'type')::public.block_type, 'paragraph'::public.block_type),
        v_block_record ->> 'text',
        v_block_record ->> 'media_url',
        v_block_record ->> 'caption',
        v_block_record ->> 'credit',
        v_block_record ->> 'media_type',
        v_block_record ->> 'file_format',
        v_block_record ->> 'file_size',
        v_now_iso,
        v_now_iso
      );
    END LOOP;
  ELSE
    -- 블록이 없는 경우 기본 빈 문단 1개 생성
    INSERT INTO public.article_blocks (
      article_id,
      position_index,
      type,
      text
    )
    VALUES (
      v_target.article_id,
      0,
      'paragraph'::public.block_type,
      ''
    );
  END IF;

  -- ========================================================
  -- [핵심 단계 C]: 복원 완료를 나타내는 새 버전 기록
  -- ========================================================
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
    created_by,
    created_at
  )
  VALUES (
    v_target.article_id,
    v_new_version_num,
    v_target.title,
    v_target.subtitle,
    v_target.blocks_count,
    v_target.char_count,
    v_target.snapshot_data,
    'v' || v_target.version_number || ' 버전으로 복원됨',
    v_uid,
    v_now_iso
  );

  RETURN QUERY
  SELECT 
    true,
    v_target.article_id,
    v_target.version_number,
    v_backup_version_num,
    v_new_version_num;
END;
$$;

-- 7. 함수 권한 설정
REVOKE EXECUTE ON FUNCTION public.get_article_versions(UUID) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_article_versions(UUID) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.create_article_version(UUID, TEXT) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_article_version(UUID, TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.restore_article_version(UUID) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.restore_article_version(UUID) TO authenticated;
