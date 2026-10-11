-- 20261007154000_add_feedback_color_column.sql
-- PRESS-CMS: 피드백별 고유 형광펜 색상 저장 컬럼 추가 (emerald, amber, blue, rose, purple)

ALTER TABLE public.article_feedbacks
  ADD COLUMN IF NOT EXISTS color TEXT DEFAULT 'emerald';

COMMENT ON COLUMN public.article_feedbacks.color IS '피드백 형광펜 색상 (emerald, amber, blue, rose, purple)';
