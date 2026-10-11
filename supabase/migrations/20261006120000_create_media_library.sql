-- ========================================================
-- PRESS-CMS: Media Library & Usage Tracking Migration
-- ========================================================
-- 1. 미디어 파일명 및 프로젝트 복합 인덱스 (기존 테이블 구조 100% 보존)
-- 2. 미디어 사용 기사 추적 RPC (get_media_article_usages)
--    - 호출자 인증 및 can_access_article 보안 필터 적용 (권한 없는 기사 정보 유출 원천 차단)
-- 3. 서버 레벨 미디어 삭제 안전성 보장 RPC (delete_media_asset)
--    - 기사 본문(article_blocks)에서 사용 중인 미디어는 DB/스토리지 삭제 차단

-- 1. 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_media_original_filename 
  ON public.media (original_filename);

CREATE INDEX IF NOT EXISTS idx_media_created_desc 
  ON public.media (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_article_blocks_media_url 
  ON public.article_blocks (media_url);

-- 2. 미디어 사용 기사 추적 RPC: get_media_article_usages
-- 특정 storage_path가 어떤 기사들에서 사용 중인지 안전하게 조회
CREATE OR REPLACE FUNCTION public.get_media_article_usages(p_storage_path TEXT)
RETURNS TABLE (
  article_id UUID,
  article_title TEXT,
  article_status TEXT,
  project_id UUID,
  project_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  -- 1. 인증 확인
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '인증되지 않은 사용자입니다.';
  END IF;

  IF public.is_hr_admin(v_uid) THEN
    RETURN; -- HR 관리자는 기사 내용/용도 접근 차단
  END IF;

  IF p_storage_path IS NULL OR length(trim(p_storage_path)) = 0 THEN
    RETURN;
  END IF;

  -- 2. 호출자가 can_access_article로 접근 가능한 기사만 필터링하여 반환
  RETURN QUERY
  SELECT DISTINCT
    a.id AS article_id,
    a.title AS article_title,
    a.status::TEXT AS article_status,
    p.id AS project_id,
    p.name AS project_name
  FROM public.article_blocks b
  JOIN public.articles a ON a.id = b.article_id
  JOIN public.projects p ON p.id = a.project_id
  WHERE b.media_url = p_storage_path
    AND public.can_access_article(a.id)
  ORDER BY a.title ASC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_media_article_usages(TEXT) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_media_article_usages(TEXT) TO authenticated;

-- 3. 서버 레벨 미디어 안전 삭제 RPC: delete_media_asset
-- 기사 본문(article_blocks)에서 사용 중인 경우 삭제를 원천 차단
CREATE OR REPLACE FUNCTION public.delete_media_asset(p_media_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_media RECORD;
  v_usage_count INT := 0;
BEGIN
  -- 1. 인증 확인
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '인증되지 않은 사용자입니다.';
  END IF;

  IF public.is_hr_admin(v_uid) THEN
    RAISE EXCEPTION '인사 관리자는 미디어를 삭제할 수 없습니다.';
  END IF;

  -- 2. 미디어 존재 확인 및 소유권/프로젝트 권한 검증
  SELECT m.id, m.storage_path, m.uploaded_by, m.project_id, p.owner_id
  INTO v_media
  FROM public.media m
  JOIN public.projects p ON p.id = m.project_id
  WHERE m.id = p_media_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '삭제할 미디어를 찾을 수 없습니다.';
  END IF;

  -- 본인이 업로드했거나 프로젝트 소유자인 경우에만 삭제 가능
  IF v_media.uploaded_by != v_uid AND v_media.owner_id != v_uid THEN
    RAISE EXCEPTION '미디어 업로더 본인 또는 프로젝트 소유자만 삭제할 수 있습니다.';
  END IF;

  -- 3. 기사 본문(article_blocks) 전체 참조 여부 전수 검사
  SELECT COUNT(DISTINCT b.article_id) INTO v_usage_count
  FROM public.article_blocks b
  WHERE b.media_url = v_media.storage_path;

  IF v_usage_count > 0 THEN
    RAISE EXCEPTION '현재 기사 본문에서 사용 중인 미디어는 삭제할 수 없습니다. (사용 중인 기사: %건)', v_usage_count;
  END IF;

  -- 4. DB 레코드 삭제
  DELETE FROM public.media WHERE id = p_media_id;

  -- 클라이언트가 Storage 파일도 정리할 수 있도록 삭제된 storage_path 반환
  RETURN v_media.storage_path;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_media_asset(UUID) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_media_asset(UUID) TO authenticated;
