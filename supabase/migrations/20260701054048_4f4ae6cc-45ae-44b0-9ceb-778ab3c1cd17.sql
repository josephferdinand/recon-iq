-- Add fallback priority to LLM providers so admins can designate primary + up to 3 fallbacks per scope/tenant
ALTER TABLE public.llm_providers
  ADD COLUMN IF NOT EXISTS priority smallint;

COMMENT ON COLUMN public.llm_providers.priority IS
  '0 = primary, 1 = fallback #1, 2 = fallback #2, 3 = fallback #3, NULL = unassigned. Enforced only when is_active = true.';

-- Only one provider per (scope, tenant, priority) may be active at a time
CREATE UNIQUE INDEX IF NOT EXISTS llm_providers_active_priority_uidx
  ON public.llm_providers (scope, COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), priority)
  WHERE is_active = true AND priority IS NOT NULL;