-- ========================================================
-- 기사 수정이력(버전) 개별 삭제
-- ========================================================
-- 1. 업무 이력(audit_logs)에 VERSION_DELETED 종류 추가
-- 2. delete_article_version RPC: 버전 만든 사람(또는 기사 작성자·프로젝트 소유자)만 삭제,
--    출고 완료된 기사는 삭제 불가, 삭제 사실은 업무 이력에 남김
-- (기사 자체를 삭제하면 article_versions는 ON DELETE CASCADE로 자동 삭제됨)

-- 1. audit_logs action 목록 확장
ALTER TABLE public.audit_logs DROP CONSTRAINT IF EXISTS audit_logs_action_check;
ALTER TABLE public.audit_logs
  ADD CONSTRAINT audit_logs_action_check CHECK (
    action IN (
      'ARTICLE_CREATED',
      'REVIEW_REQUESTED',
      'CHANGES_REQUESTED',
      'REVIEW_RESUBMITTED',
      'ARTICLE_APPROVED',
      'ARTICLE_PUBLISHED',
      'ARTICLE_ASSIGNED',
      'DEADLINE_CHANGED',
      'VERSION_DELETED'
    )
  );

-- 2. 삭제 RPC
CREATE OR REPLACE FUNCTION public.delete_article_version(p_version_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_ver public.article_versions;
  v_article public.articles;
  v_project_owner UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다.';
  END IF;

  IF public.is_hr_admin(v_uid) THEN
    RAISE EXCEPTION '인사 관리자는 기사 이력을 삭제할 수 없습니다.';
  END IF;

  SELECT * INTO v_ver FROM public.article_versions WHERE id = p_version_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '삭제할 버전을 찾을 수 없습니다.';
  END IF;

  SELECT * INTO v_article FROM public.articles WHERE id = v_ver.article_id;
  SELECT owner_id INTO v_project_owner FROM public.projects WHERE id = v_article.project_id;

  IF NOT (
    v_ver.created_by = v_uid
    OR v_article.author_id = v_uid
    OR v_project_owner = v_uid
  ) THEN
    RAISE EXCEPTION '본인이 만든 버전(또는 내 기사의 버전)만 삭제할 수 있습니다.';
  END IF;

  IF v_article.status::text = 'published' THEN
    RAISE EXCEPTION '출고 완료된 기사의 이력은 삭제할 수 없습니다.';
  END IF;

  DELETE FROM public.article_versions WHERE id = p_version_id;

  INSERT INTO public.audit_logs (actor_id, article_id, project_id, action, metadata, created_at)
  VALUES (
    v_uid,
    v_article.id,
    v_article.project_id,
    'VERSION_DELETED',
    jsonb_build_object(
      'version_number', v_ver.version_number,
      'summary', v_ver.summary
    ),
    timezone('utc'::text, now())
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_article_version(UUID) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_article_version(UUID) TO authenticated;
