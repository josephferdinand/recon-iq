ALTER VIEW public.v_mkt_certification_report SET (security_invoker = true);
ALTER TABLE public.mkt_llm_providers DROP COLUMN IF EXISTS api_key;