-- ========================================================
-- PRESS-CMS: 5단계 실제 Media Library 및 Storage 구성
-- ========================================================

-- 1. updated_at 자동 갱신 범용 트리거 함수 (존재하지 않을 시 생성)
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  new.updated_at = timezone('utc'::text, now());
  RETURN new;
END;
$$ LANGUAGE plpgsql;

-- 2. public.media 테이블 생성
CREATE TABLE IF NOT EXISTS public.media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL REFERENCES public.profiles(id),

  -- Storage 영속 정보
  storage_path TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  original_filename TEXT,

  -- 미디어 파일 규격
  media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video')),
  file_format TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size BIGINT NOT NULL,

  -- 메타데이터 (브라우저 추출)
  width INTEGER,
  height INTEGER,
  duration_seconds NUMERIC,

  -- 편집국 분류 및 바이라인
  category TEXT DEFAULT 'press',
  caption TEXT,
  credit TEXT,

  -- 향후 AI 분석 대비 확장 필드 (기본값 'uploaded'로 대기 상태 유지)
  ai_analysis_status TEXT NOT NULL DEFAULT 'uploaded' CHECK (ai_analysis_status IN ('uploaded', 'analyzing', 'completed', 'failed')),
  ai_category TEXT,
  ai_tags TEXT[] DEFAULT '{}'::TEXT[],
  ai_caption TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),

  -- 파일 형식 및 MIME type 무결성 제약
  CONSTRAINT chk_media_format_mime CHECK (
    (media_type = 'image' AND mime_type IN ('image/jpeg', 'image/png', 'image/webp') AND file_format IN ('JPG', 'JPEG', 'PNG', 'WEBP'))
    OR
    (media_type = 'video' AND mime_type = 'video/mp4' AND file_format = 'MP4')
  )
);

-- 3. 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_media_project_id_created 
  ON public.media (project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_media_uploaded_by 
  ON public.media (uploaded_by);

CREATE INDEX IF NOT EXISTS idx_media_storage_path 
  ON public.media (storage_path);

-- 4. updated_at 트리거 연결
DROP TRIGGER IF EXISTS trigger_media_updated_at ON public.media;
CREATE TRIGGER trigger_media_updated_at
  BEFORE UPDATE ON public.media
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- 5. public.media RLS 활성화 및 정책 구성
ALTER TABLE public.media ENABLE ROW LEVEL SECURITY;

-- [SELECT]: 프로젝트 접근 권한이 있는 인증된 사용자 (부장 검토 모드 포함, HR 관리자는 차단)
DROP POLICY IF EXISTS "Users can view media in accessible projects" ON public.media;
CREATE POLICY "Users can view media in accessible projects" ON public.media
FOR SELECT TO authenticated
USING (
  NOT public.is_hr_admin(auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = public.media.project_id
      AND public.can_access_project(p.id, p.owner_id, p.visibility, auth.uid())
  )
);

-- [INSERT]: 프로젝트 소유자 본인만 업로드 가능 (Manager Review 검토자 및 타인은 불가)
DROP POLICY IF EXISTS "Project owners can insert media" ON public.media;
CREATE POLICY "Project owners can insert media" ON public.media
FOR INSERT TO authenticated
WITH CHECK (
  NOT public.is_hr_admin(auth.uid())
  AND auth.uid() = uploaded_by
  AND EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = public.media.project_id
      AND p.owner_id = auth.uid()
  )
);

-- [UPDATE]: 프로젝트 소유자만 미디어 메타데이터 수정 가능 (Manager Review 검토자는 불가)
DROP POLICY IF EXISTS "Project owners can update media" ON public.media;
CREATE POLICY "Project owners can update media" ON public.media
FOR UPDATE TO authenticated
USING (
  NOT public.is_hr_admin(auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = public.media.project_id
      AND p.owner_id = auth.uid()
  )
)
WITH CHECK (
  NOT public.is_hr_admin(auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = public.media.project_id
      AND p.owner_id = auth.uid()
  )
);

-- [DELETE]: 프로젝트 소유자만 미디어 삭제 가능
DROP POLICY IF EXISTS "Project owners can delete media" ON public.media;
CREATE POLICY "Project owners can delete media" ON public.media
FOR DELETE TO authenticated
USING (
  NOT public.is_hr_admin(auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = public.media.project_id
      AND p.owner_id = auth.uid()
  )
);

-- 6. newsroom-media Private Storage Bucket 구성
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'newsroom-media',
  'newsroom-media',
  false,
  104857600, -- 100MB 상한선
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'video/mp4']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 104857600,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'video/mp4'];

-- 7. storage.objects 정책 (UUID 캐스팅 안전성 방어 포함)
-- [Storage SELECT]: 해당 프로젝트에 접근 권한이 있는 사용자 (Signed URL 발급 및 다운로드)
DROP POLICY IF EXISTS "Users can read project media objects" ON storage.objects;
CREATE POLICY "Users can read project media objects" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'newsroom-media'
  AND NOT public.is_hr_admin(auth.uid())
  AND ((storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  AND EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = ((storage.foldername(name))[1])::uuid
      AND public.can_access_project(p.id, p.owner_id, p.visibility, auth.uid())
  )
);

-- [Storage INSERT]: 프로젝트 소유자만 파일 업로드 가능
DROP POLICY IF EXISTS "Project owners can upload media objects" ON storage.objects;
CREATE POLICY "Project owners can upload media objects" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'newsroom-media'
  AND NOT public.is_hr_admin(auth.uid())
  AND ((storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  AND EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = ((storage.foldername(name))[1])::uuid
      AND p.owner_id = auth.uid()
  )
);

-- [Storage DELETE]: 프로젝트 소유자만 파일 삭제 가능
DROP POLICY IF EXISTS "Project owners can delete media objects" ON storage.objects;
CREATE POLICY "Project owners can delete media objects" ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'newsroom-media'
  AND NOT public.is_hr_admin(auth.uid())
  AND ((storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  AND EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = ((storage.foldername(name))[1])::uuid
      AND p.owner_id = auth.uid()
  )
);
