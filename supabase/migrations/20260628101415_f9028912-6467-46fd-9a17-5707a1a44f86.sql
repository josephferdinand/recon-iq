
-- ============================================================
-- P0 #1: Cascading rule sets + per-field tolerance ladders
-- ============================================================

CREATE TABLE IF NOT EXISTS public.recon_cascade_passes (
  id          uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  recon_id    uuid NOT NULL REFERENCES public.recon_definitions(id) ON DELETE CASCADE,
  pass_order  int  NOT NULL,
  label       text NOT NULL,
  outcome     text NOT NULL DEFAULT 'auto_match'
              CHECK (outcome IN ('auto_match','match_with_break','suggest','review')),
  rules_json  jsonb NOT NULL DEFAULT '[]'::jsonb,
  enabled     boolean NOT NULL DEFAULT true,
  notes       text,
  created_by  uuid REFERENCES auth.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recon_id, pass_order)
);

CREATE INDEX IF NOT EXISTS idx_cascade_passes_recon
  ON public.recon_cascade_passes(recon_id, pass_order);
CREATE INDEX IF NOT EXISTS idx_cascade_passes_tenant
  ON public.recon_cascade_passes(tenant_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.recon_cascade_passes TO authenticated;
GRANT ALL ON public.recon_cascade_passes TO service_role;

ALTER TABLE public.recon_cascade_passes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_members_read_cascade_passes"
  ON public.recon_cascade_passes FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id));

CREATE POLICY "approvers_write_cascade_passes"
  ON public.recon_cascade_passes FOR ALL TO authenticated
  USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    OR public.user_can_access_recon(auth.uid(), recon_id, 'edit')
  )
  WITH CHECK (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    OR public.user_can_access_recon(auth.uid(), recon_id, 'edit')
  );

CREATE TRIGGER trg_cascade_passes_updated
  BEFORE UPDATE ON public.recon_cascade_passes
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();


-- ---------- Tolerance ladders ----------
CREATE TABLE IF NOT EXISTS public.recon_tolerance_ladders (
  id                 uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  recon_id           uuid NOT NULL REFERENCES public.recon_definitions(id) ON DELETE CASCADE,
  applies_to_pass_id uuid REFERENCES public.recon_cascade_passes(id) ON DELETE CASCADE,
  field_name         text NOT NULL,
  field_type         text NOT NULL DEFAULT 'numeric'
                     CHECK (field_type IN ('numeric','date','string')),
  rungs_json         jsonb NOT NULL DEFAULT '[]'::jsonb,
  enabled            boolean NOT NULL DEFAULT true,
  notes              text,
  created_by         uuid REFERENCES auth.users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tolerance_ladders_recon
  ON public.recon_tolerance_ladders(recon_id);
CREATE INDEX IF NOT EXISTS idx_tolerance_ladders_pass
  ON public.recon_tolerance_ladders(applies_to_pass_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.recon_tolerance_ladders TO authenticated;
GRANT ALL ON public.recon_tolerance_ladders TO service_role;

ALTER TABLE public.recon_tolerance_ladders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_members_read_tolerance_ladders"
  ON public.recon_tolerance_ladders FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id));

CREATE POLICY "approvers_write_tolerance_ladders"
  ON public.recon_tolerance_ladders FOR ALL TO authenticated
  USING (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    OR public.user_can_access_recon(auth.uid(), recon_id, 'edit')
  )
  WITH CHECK (
    public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'::tenant_role)
    OR public.user_can_access_recon(auth.uid(), recon_id, 'edit')
  );

CREATE TRIGGER trg_tolerance_ladders_updated
  BEFORE UPDATE ON public.recon_tolerance_ladders
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

COMMENT ON TABLE public.recon_cascade_passes IS
  'Cascading multi-pass matching: pass 1 = exact, pass 2 = widened tolerances, pass 3 = fuzzy, etc. Closes Duco-parity gap on rule waterfalls.';
COMMENT ON TABLE public.recon_tolerance_ladders IS
  'Per-field tolerance bands. Each rung defines abs/pct limit + outcome (auto_match/match_with_break/suggest/review).';
