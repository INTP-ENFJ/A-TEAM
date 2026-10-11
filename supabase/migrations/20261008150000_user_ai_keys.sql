-- Per-user AI keys, stored encrypted (AES-GCM). Only Edge Functions (service role) can read or write.
CREATE TABLE IF NOT EXISTS public.user_ai_keys (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('gemini', 'openai', 'anthropic', 'custom')),
  key_cipher text NOT NULL,
  key_iv text NOT NULL,
  key_last4 text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, provider)
);

CREATE TABLE IF NOT EXISTS public.user_ai_prefs (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('gemini', 'openai', 'anthropic', 'custom')),
  model text,
  endpoint text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_ai_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_ai_prefs ENABLE ROW LEVEL SECURITY;

-- No policies on purpose: browsers (anon/authenticated) cannot touch these tables.
REVOKE ALL ON public.user_ai_keys FROM anon, authenticated;
REVOKE ALL ON public.user_ai_prefs FROM anon, authenticated;
GRANT ALL ON public.user_ai_keys TO service_role;
GRANT ALL ON public.user_ai_prefs TO service_role;
