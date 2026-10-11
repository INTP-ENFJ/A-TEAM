-- PRESS-CMS: Allow authorized workflow RPCs to create article versions
-- request_article_changes, approve_article, publish_article 등 데스크/부서 검증을 거친 워크플로우 RPC에서
-- 자동 버전 스냅샷(create_article_version)을 안전하게 생성할 수 있도록 플래그 조건을 허용합니다.

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
  -- 동일 기사에 대한 동시 버전 생성 요청을 완벽하게 직렬화
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

  -- 워크플로우 RPC(press.authorized_workflow_rpc = 'true')를 통한 호출이거나 기사/프로젝트 소유자인 경우 허용
  IF current_setting('press.authorized_workflow_rpc', true) IS DISTINCT FROM 'true'
     AND v_article.author_id != v_uid 
     AND v_article.owner_id != v_uid THEN
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

  -- 6. article_versions에 삽입 (snapshot_data 컬럼 정확 매핑)
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
