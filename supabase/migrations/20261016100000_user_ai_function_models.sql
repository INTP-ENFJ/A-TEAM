-- 기능별(검수·사진 분석·초안) AI 공급자·모델을 사람마다 따로 저장하는 칸
-- 값 예: {"review": {"provider": "anthropic", "model": "claude-sonnet-5-5"}, "draft": {"provider": "gemini", "model": "gemini-3.8-flash"}}
-- 비어 있는 기능은 기본 설정(공급자·모델)을 따른다
alter table public.user_ai_prefs
  add column if not exists function_models jsonb not null default '{}'::jsonb;
