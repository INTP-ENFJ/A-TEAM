-- PRESS-CMS: Create ai_draft_sessions table and add article_generation_model to ai_system_settings
-- 질문형 인터뷰 초안 생성(AI Interview Draft) 세션 관리 및 3번째 모델 라우팅 슬롯을 추가합니다.

-- 1. ai_draft_sessions 테이블 생성
CREATE TABLE IF NOT EXISTS public.ai_draft_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id UUID NOT NULL REFERENCES public.articles(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('collecting', 'finalized')) DEFAULT 'collecting',
  draft_state JSONB NOT NULL DEFAULT '{
    "topic": "",
    "keywords": [],
    "five_w1h": {
      "who": null,
      "what": null,
      "when": null,
      "where": null,
      "why": null,
      "how": null
    },
    "quotes": [],
    "key_figures": [],
    "open_gaps": [],
    "title_candidates": [],
    "lead_paragraph": null,
    "body_blocks": []
  }'::jsonb,
  conversation JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_ai_draft_sessions_article ON public.ai_draft_sessions(article_id);
CREATE INDEX IF NOT EXISTS idx_ai_draft_sessions_author ON public.ai_draft_sessions(author_id);
CREATE INDEX IF NOT EXISTS idx_ai_draft_sessions_status ON public.ai_draft_sessions(status);

-- 2. RLS 활성화 및 보안 정책 수립
ALTER TABLE public.ai_draft_sessions ENABLE ROW LEVEL SECURITY;

-- SELECT 정책: 기사 작성자 본인이거나 해당 article 접근 권한 보유자 (can_access_article 함수 재사용)
DROP POLICY IF EXISTS "Users can read accessible ai_draft_sessions" ON public.ai_draft_sessions;
CREATE POLICY "Users can read accessible ai_draft_sessions"
ON public.ai_draft_sessions
FOR SELECT
TO authenticated
USING (
  author_id = auth.uid() 
  OR public.can_access_article(article_id, auth.uid())
);

-- INSERT 정책: 작성자 본인 계정으로만 세션 생성 가능 (인사 관리자 배제)
DROP POLICY IF EXISTS "Authors can insert ai_draft_sessions" ON public.ai_draft_sessions;
CREATE POLICY "Authors can insert ai_draft_sessions"
ON public.ai_draft_sessions
FOR INSERT
TO authenticated
WITH CHECK (
  author_id = auth.uid()
  AND NOT public.is_hr_admin(auth.uid())
);

-- UPDATE 정책: 작성자 본인 또는 기사 접근 권한 보유자 업데이트 허용 (인사 관리자 배제)
DROP POLICY IF EXISTS "Authors can update ai_draft_sessions" ON public.ai_draft_sessions;
CREATE POLICY "Authors can update ai_draft_sessions"
ON public.ai_draft_sessions
FOR UPDATE
TO authenticated
USING (
  (author_id = auth.uid() OR public.can_access_article(article_id, auth.uid()))
  AND NOT public.is_hr_admin(auth.uid())
)
WITH CHECK (
  (author_id = auth.uid() OR public.can_access_article(article_id, auth.uid()))
  AND NOT public.is_hr_admin(auth.uid())
);

-- DELETE 정책: 세션 작성자 본인만 삭제 가능
DROP POLICY IF EXISTS "Authors can delete ai_draft_sessions" ON public.ai_draft_sessions;
CREATE POLICY "Authors can delete ai_draft_sessions"
ON public.ai_draft_sessions
FOR DELETE
TO authenticated
USING (
  author_id = auth.uid()
  AND NOT public.is_hr_admin(auth.uid())
);

-- 권한 부여
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_draft_sessions TO authenticated;

-- 3. ai_system_settings에 article_generation_model 컬럼 추가
ALTER TABLE public.ai_system_settings 
ADD COLUMN IF NOT EXISTS article_generation_model TEXT DEFAULT 'gemini-3.8-flash'
CHECK (article_generation_model IN (
  'gemini-3.8-flash',
  'gemini-flash-latest',
  'gemini-3.1-pro-preview',
  'gemini-3.1-flash-lite'
));

-- 기본 레코드 값 보장
UPDATE public.ai_system_settings
SET article_generation_model = 'gemini-3.8-flash'
WHERE id = 'default' AND article_generation_model IS NULL;
