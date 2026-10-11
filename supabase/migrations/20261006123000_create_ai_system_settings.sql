-- ========================================================
-- PRESS-CMS: AI 시스템 설정 및 모델 라우팅 테이블
-- ========================================================

CREATE TABLE IF NOT EXISTS public.ai_system_settings (
  id TEXT PRIMARY KEY DEFAULT 'default',
  active_model TEXT NOT NULL DEFAULT 'gemini-3.8-flash' CHECK (active_model IN ('gemini-3.8-flash', 'gemini-flash-latest', 'gemini-3.1-pro-preview', 'gemini-3.1-flash-lite')),
  article_review_model TEXT NOT NULL DEFAULT 'gemini-3.8-flash' CHECK (article_review_model IN ('gemini-3.8-flash', 'gemini-flash-latest', 'gemini-3.1-pro-preview', 'gemini-3.1-flash-lite')),
  media_analysis_model TEXT NOT NULL DEFAULT 'gemini-3.8-flash' CHECK (media_analysis_model IN ('gemini-3.8-flash', 'gemini-flash-latest', 'gemini-3.1-pro-preview', 'gemini-3.1-flash-lite')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- 기본 단일 레코드 시드
INSERT INTO public.ai_system_settings (id, active_model, article_review_model, media_analysis_model)
VALUES ('default', 'gemini-3.8-flash', 'gemini-3.8-flash', 'gemini-3.8-flash')
ON CONFLICT (id) DO NOTHING;

-- RLS 활성화
ALTER TABLE public.ai_system_settings ENABLE ROW LEVEL SECURITY;

-- 1. 인증된 사용자는 누구나 설정 조회 가능
CREATE POLICY "ai_system_settings_select_policy"
ON public.ai_system_settings
FOR SELECT
TO authenticated
USING (true);

-- 2. 수정은 데스크(desk_editor, editor_in_chief) 또는 부장(manager), 차장(deputy)만 가능
CREATE POLICY "ai_system_settings_update_policy"
ON public.ai_system_settings
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND (
        p.role IN ('desk_editor'::public.user_role, 'editor_in_chief'::public.user_role)
        OR p.rank IN ('manager'::public.user_rank, 'deputy'::public.user_rank)
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND (
        p.role IN ('desk_editor'::public.user_role, 'editor_in_chief'::public.user_role)
        OR p.rank IN ('manager'::public.user_rank, 'deputy'::public.user_rank)
      )
  )
);

-- PostgREST 권한 부여
GRANT SELECT, UPDATE ON TABLE public.ai_system_settings TO authenticated;
GRANT SELECT ON TABLE public.ai_system_settings TO anon;
