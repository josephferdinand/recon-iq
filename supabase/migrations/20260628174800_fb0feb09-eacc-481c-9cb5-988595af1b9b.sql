ALTER TABLE public.aidp_prediction_fields
  ADD COLUMN IF NOT EXISTS value_text   text,
  ADD COLUMN IF NOT EXISTS value_number numeric,
  ADD COLUMN IF NOT EXISTS value_date   date,
  ADD COLUMN IF NOT EXISTS value_json   jsonb;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='aidp_output_decision') THEN
    CREATE TYPE public.aidp_output_decision AS ENUM ('auto_accepted','human_accepted','human_rejected');
  END IF;
END $$;

ALTER TABLE public.aidp_outputs
  ADD COLUMN IF NOT EXISTS decision public.aidp_output_decision NOT NULL DEFAULT 'human_accepted';

CREATE TABLE IF NOT EXISTS public.aidp_api_host_allowlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  host text NOT NULL,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, host)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.aidp_api_host_allowlist TO authenticated;
GRANT ALL ON public.aidp_api_host_allowlist TO service_role;

ALTER TABLE public.aidp_api_host_allowlist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS aidp_host_allow_rw ON public.aidp_api_host_allowlist;
CREATE POLICY aidp_host_allow_rw ON public.aidp_api_host_allowlist
  FOR ALL TO authenticated
  USING (has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role) OR is_platform_admin(auth.uid()))
  WITH CHECK (has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role) OR is_platform_admin(auth.uid()));