-- Allow photos that belong to no project (photo desk uploads straight to the newsroom library).
-- Photos with a project keep the existing rules. Photos without a project:
--   * can be seen by every non-HR signed-in staff member
--   * can be inserted, edited and deleted only by the uploader
--   * cannot be deleted while an article still uses them

ALTER TABLE public.media ALTER COLUMN project_id DROP NOT NULL;

DROP POLICY IF EXISTS "Staff can view library media" ON public.media;
CREATE POLICY "Staff can view library media" ON public.media
FOR SELECT TO authenticated
USING (
  project_id IS NULL
  AND NOT public.is_hr_admin(auth.uid())
);

DROP POLICY IF EXISTS "Uploaders can insert library media" ON public.media;
CREATE POLICY "Uploaders can insert library media" ON public.media
FOR INSERT TO authenticated
WITH CHECK (
  project_id IS NULL
  AND NOT public.is_hr_admin(auth.uid())
  AND uploaded_by = auth.uid()
);

DROP POLICY IF EXISTS "Uploaders can update library media" ON public.media;
CREATE POLICY "Uploaders can update library media" ON public.media
FOR UPDATE TO authenticated
USING (
  project_id IS NULL
  AND NOT public.is_hr_admin(auth.uid())
  AND uploaded_by = auth.uid()
)
WITH CHECK (
  project_id IS NULL
  AND NOT public.is_hr_admin(auth.uid())
  AND uploaded_by = auth.uid()
);

DROP POLICY IF EXISTS "Uploaders can delete library media" ON public.media;
CREATE POLICY "Uploaders can delete library media" ON public.media
FOR DELETE TO authenticated
USING (
  project_id IS NULL
  AND NOT public.is_hr_admin(auth.uid())
  AND uploaded_by = auth.uid()
  AND NOT EXISTS (
    SELECT 1 FROM public.article_blocks b
    WHERE b.media_url = public.media.storage_path
  )
);

-- Storage: files without a project are stored as {user_id}/library/{type}s/{file}
DROP POLICY IF EXISTS "Staff can read library media objects" ON storage.objects;
CREATE POLICY "Staff can read library media objects" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'newsroom-media'
  AND NOT public.is_hr_admin(auth.uid())
  AND (storage.foldername(storage.objects.name))[2] = 'library'
);

DROP POLICY IF EXISTS "Uploaders can upload library media objects" ON storage.objects;
CREATE POLICY "Uploaders can upload library media objects" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'newsroom-media'
  AND NOT public.is_hr_admin(auth.uid())
  AND (storage.foldername(storage.objects.name))[2] = 'library'
  AND (storage.foldername(storage.objects.name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "Uploaders can delete library media objects" ON storage.objects;
CREATE POLICY "Uploaders can delete library media objects" ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'newsroom-media'
  AND NOT public.is_hr_admin(auth.uid())
  AND (storage.foldername(storage.objects.name))[2] = 'library'
  AND (storage.foldername(storage.objects.name))[1] = auth.uid()::text
  AND NOT EXISTS (
    SELECT 1 FROM public.article_blocks b
    WHERE b.media_url = storage.objects.name
  )
);

-- Safe delete function: works with or without a project
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
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF public.is_hr_admin(v_uid) THEN
    RAISE EXCEPTION 'HR admin cannot delete media';
  END IF;

  SELECT m.id, m.storage_path, m.uploaded_by, m.project_id, p.owner_id
  INTO v_media
  FROM public.media m
  LEFT JOIN public.projects p ON p.id = m.project_id
  WHERE m.id = p_media_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'media not found';
  END IF;

  IF v_media.uploaded_by <> v_uid AND v_media.owner_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'only the uploader or the project owner can delete this media';
  END IF;

  SELECT COUNT(DISTINCT b.article_id) INTO v_usage_count
  FROM public.article_blocks b
  WHERE b.media_url = v_media.storage_path;

  IF v_usage_count > 0 THEN
    RAISE EXCEPTION 'media is used in % article(s) and cannot be deleted', v_usage_count;
  END IF;

  DELETE FROM public.media WHERE id = p_media_id;

  RETURN v_media.storage_path;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_media_asset(UUID) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_media_asset(UUID) TO authenticated;
