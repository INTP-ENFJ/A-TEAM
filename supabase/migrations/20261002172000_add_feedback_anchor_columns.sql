-- PRESS-CMS: article_feedbacks 드래그 피드백 앵커 컬럼 추가 (nullable)
-- 기존 데이터 완전 호환 및 파괴적 변경 없음

ALTER TABLE public.article_feedbacks
  ADD COLUMN IF NOT EXISTS block_id UUID REFERENCES public.article_blocks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS context_before TEXT,
  ADD COLUMN IF NOT EXISTS context_after TEXT,
  ADD COLUMN IF NOT EXISTS start_offset INTEGER,
  ADD COLUMN IF NOT EXISTS end_offset INTEGER;

-- 인덱스 추가 (조회 성능 최적화)
CREATE INDEX IF NOT EXISTS idx_article_feedbacks_block_id ON public.article_feedbacks(block_id);
