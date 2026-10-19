-- PRESS-CMS: 새 AI 모델 이름도 저장할 수 있게 한다.
-- 이전에는 article_generation_model 칸에 옛 모델 4개만 저장할 수 있는 제한이 있어서
-- gemini-4-argon 같은 새 모델을 고르고 저장하면 실패했다. 모델 이름 검사는 서버 함수가 하므로 이 제한은 없앤다.
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'ai_system_settings'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%article_generation_model%'
  LOOP
    EXECUTE format('ALTER TABLE public.ai_system_settings DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

-- 모델 이름은 글자·숫자·점·하이픈 등만, 100자 이하로 제한 (이상한 값 방지)
ALTER TABLE public.ai_system_settings
  ADD CONSTRAINT ai_system_settings_article_generation_model_format
  CHECK (article_generation_model IS NULL OR article_generation_model ~ '^[A-Za-z0-9._:/-]{1,100}$');
