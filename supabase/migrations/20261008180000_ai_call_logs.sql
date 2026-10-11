-- AI call logs: counts, success and timing only (no prompts, no outputs, no user-visible text).

CREATE TABLE IF NOT EXISTS public.ai_call_logs (
  id bigserial PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  fn text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  ok boolean NOT NULL,
  error_code text,
  latency_ms integer NOT NULL DEFAULT 0,
  in_chars integer NOT NULL DEFAULT 0,
  out_chars integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_call_logs_created ON public.ai_call_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_call_logs_model ON public.ai_call_logs (provider, model, fn);

ALTER TABLE public.ai_call_logs ENABLE ROW LEVEL SECURITY;

-- No policies on purpose: only Edge Functions (service role) write, and reads go through the summary function below.
REVOKE ALL ON public.ai_call_logs FROM anon, authenticated;
GRANT ALL ON public.ai_call_logs TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.ai_call_logs_id_seq TO service_role;

-- Team-wide summary for the last N days, grouped by function and model.
CREATE OR REPLACE FUNCTION public.ai_call_summary(p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
  days integer := LEAST(GREATEST(COALESCE(p_days, 30), 1), 365);
BEGIN
  IF auth.uid() IS NULL OR public.is_hr_admin(auth.uid()) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.calls DESC), '[]'::jsonb)
  INTO result
  FROM (
    SELECT
      fn,
      provider,
      model,
      COUNT(*)::int AS calls,
      COUNT(*) FILTER (WHERE ok)::int AS ok_calls,
      COALESCE(ROUND(AVG(latency_ms))::int, 0) AS avg_latency_ms,
      COALESCE(ROUND(AVG(out_chars) FILTER (WHERE ok))::int, 0) AS avg_out_chars
    FROM public.ai_call_logs
    WHERE created_at >= now() - make_interval(days => days)
    GROUP BY fn, provider, model
  ) t;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.ai_call_summary(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_call_summary(integer) TO authenticated;
