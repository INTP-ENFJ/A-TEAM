-- PRESS-CMS: 승인 대기 계정 제한을 "읽기는 허용, 쓰기만 차단"으로 바로잡는다.
-- (20261013100000 은 읽기까지 막아서, 발표 자료에 적힌 "대시보드 · 공유된 기사 읽기" 와 어긋났다.)
-- 승인 대기 = 로그인 토큰의 app_metadata.approval = 'pending' (본인이 바꿀 수 없음).
-- 서버(service role)와 승인된 계정, 로그인 전 요청에는 영향이 없다.

-- 1. 이전 정책 제거
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'projects', 'articles', 'media', 'article_versions',
    'ai_draft_sessions', 'audit_logs', 'hr_audit_logs'
  ]
  LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS "block_pending_accounts" ON public.%I', t);
    END IF;
  END LOOP;
END $$;
DROP POLICY IF EXISTS "block_pending_accounts" ON storage.objects;

-- 2. 쓰기 차단 함수 (트리거라서 RPC 안에서 이뤄지는 쓰기도 막는다)
CREATE OR REPLACE FUNCTION public.block_pending_writes()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF COALESCE(auth.jwt() -> 'app_metadata' ->> 'approval', '') = 'pending' THEN
    RAISE EXCEPTION '인사부 승인 후에 사용할 수 있습니다.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'projects', 'articles', 'article_blocks', 'media', 'article_versions',
    'ai_draft_sessions', 'article_feedbacks', 'media_assets'
  ]
  LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_block_pending_writes ON public.%I', t);
      EXECUTE format(
        'CREATE TRIGGER trg_block_pending_writes BEFORE INSERT OR UPDATE OR DELETE ON public.%I '
        'FOR EACH ROW EXECUTE FUNCTION public.block_pending_writes()', t);
    END IF;
  END LOOP;
END $$;

-- 3. 저장소(사진·파일)는 쓰기만 막는다 (읽기는 그대로)
CREATE POLICY "block_pending_insert" ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (COALESCE(auth.jwt() -> 'app_metadata' ->> 'approval', '') <> 'pending');
CREATE POLICY "block_pending_update" ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (COALESCE(auth.jwt() -> 'app_metadata' ->> 'approval', '') <> 'pending')
  WITH CHECK (COALESCE(auth.jwt() -> 'app_metadata' ->> 'approval', '') <> 'pending');
CREATE POLICY "block_pending_delete" ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
  USING (COALESCE(auth.jwt() -> 'app_metadata' ->> 'approval', '') <> 'pending');
