-- PRESS-CMS: 승인 대기 계정의 서버 쪽 권한 제한
-- 가입 신청 직후 계정은 app_metadata.approval = 'pending' 이다 (본인이 바꿀 수 없음).
-- 인사부가 승인하면 'approved'로 바뀐다. 대기 중인 계정은 기사·미디어 등 업무 데이터에 접근할 수 없다.
-- 제한(RESTRICTIVE) 정책이라 기존 정책에 더해져 적용되며, 승인된 계정과 로그인 전(anon) 요청에는 영향이 없다.
-- 제외: profiles, notifications, departments, position_titles, signup_requests (로그인·가입 화면 동작에 필요)

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
      EXECUTE format(
        'CREATE POLICY "block_pending_accounts" ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
        'USING (COALESCE(auth.jwt() -> ''app_metadata'' ->> ''approval'', '''') <> ''pending'') '
        'WITH CHECK (COALESCE(auth.jwt() -> ''app_metadata'' ->> ''approval'', '''') <> ''pending'')',
        t
      );
    END IF;
  END LOOP;
END $$;

-- 저장소(사진·파일)도 같은 기준으로 막는다
DROP POLICY IF EXISTS "block_pending_accounts" ON storage.objects;
CREATE POLICY "block_pending_accounts" ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
  USING (COALESCE(auth.jwt() -> 'app_metadata' ->> 'approval', '') <> 'pending')
  WITH CHECK (COALESCE(auth.jwt() -> 'app_metadata' ->> 'approval', '') <> 'pending');
