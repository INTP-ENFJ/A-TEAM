-- ========================================================
-- PRESS-CMS: Storage objects RLS의 Column Shadowing 버그 수정
-- ========================================================
-- 원인: 서브쿼리 내부에서 unqualified 'name'을 사용할 때 PostgreSQL이
--       storage.objects.name이 아니라 projects.name(p.name)으로 바인딩하여
--       폴더명 파싱 결과가 항상 NULL이 되어 RLS가 거부되던 현상 해결.
-- 해결: storage.objects.name을 명시적으로 한정(qualify)하여 정확한 파일 경로 검증.
-- 보안: 소유자 업로드, 접근권한자 조회, 소유자 삭제, HR 차단, UUID 경로 규칙 완벽 보존.

-- 1. [Storage INSERT]: 프로젝트 소유자만 파일 업로드 가능
DROP POLICY IF EXISTS "Project owners can upload media objects" ON storage.objects;
CREATE POLICY "Project owners can upload media objects" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'newsroom-media'
  AND NOT public.is_hr_admin(auth.uid())
  AND ((storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  AND EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = ((storage.foldername(storage.objects.name))[1])::uuid
      AND p.owner_id = auth.uid()
  )
);

-- 2. [Storage SELECT]: 해당 프로젝트에 접근 권한이 있는 사용자만 조회 가능 (can_access_project 유지)
DROP POLICY IF EXISTS "Users can read project media objects" ON storage.objects;
CREATE POLICY "Users can read project media objects" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'newsroom-media'
  AND NOT public.is_hr_admin(auth.uid())
  AND ((storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  AND EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = ((storage.foldername(storage.objects.name))[1])::uuid
      AND public.can_access_project(p.id, p.owner_id, p.visibility, auth.uid())
  )
);

-- 3. [Storage DELETE]: 프로젝트 소유자만 파일 삭제 가능
DROP POLICY IF EXISTS "Project owners can delete media objects" ON storage.objects;
CREATE POLICY "Project owners can delete media objects" ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'newsroom-media'
  AND NOT public.is_hr_admin(auth.uid())
  AND ((storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  AND EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = ((storage.foldername(storage.objects.name))[1])::uuid
      AND p.owner_id = auth.uid()
  )
);
