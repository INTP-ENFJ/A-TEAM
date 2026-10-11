-- Allow a Google Cloud service-account key (used only for speech-to-text) in user_ai_keys.
-- user_ai_prefs is left unchanged on purpose: Google Cloud cannot be chosen as the chat provider.
ALTER TABLE public.user_ai_keys DROP CONSTRAINT IF EXISTS user_ai_keys_provider_check;
ALTER TABLE public.user_ai_keys
  ADD CONSTRAINT user_ai_keys_provider_check
  CHECK (provider IN ('gemini', 'openai', 'anthropic', 'custom', 'googlecloud'));
