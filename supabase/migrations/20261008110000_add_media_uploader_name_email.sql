-- 미디어: 올린 기자 이름·이메일 칸 추가 (Supabase SQL Editor에서 적용, 기록용)
ALTER TABLE public.media
  ADD COLUMN IF NOT EXISTS uploader_name TEXT;

ALTER TABLE public.media
  ADD COLUMN IF NOT EXISTS uploader_email TEXT;

UPDATE public.media m
SET uploader_name = p.name
FROM public.profiles p
WHERE m.uploaded_by = p.id
  AND m.uploader_name IS NULL;

UPDATE public.media m
SET uploader_email = u.email
FROM auth.users u
WHERE m.uploaded_by = u.id
  AND m.uploader_email IS NULL;
