-- 미디어: 올린 당시의 부서를 남기는 칸 추가 (Supabase SQL Editor에서 이미 적용됨, 기록용)
ALTER TABLE public.media
  ADD COLUMN IF NOT EXISTS uploader_department TEXT;

UPDATE public.media m
SET uploader_department = p.department
FROM public.profiles p
WHERE m.uploaded_by = p.id
  AND m.uploader_department IS NULL;
