-- Additive schema foundation for the owner-confirmed multi-BU reconciliation model.
-- Legacy recon_definitions.bu_id values are deliberately not copied or interpreted.

ALTER TABLE public.recon_definitions
  ADD COLUMN IF NOT EXISTS multi_bu_governed boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS recon_definitions_tenant_id_uq
  ON public.recon_definitions(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS business_units_tenant_id_uq
  ON public.business_units(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS tenant_groups_tenant_id_uq
  ON public.tenant_groups(tenant_id, id);

-- The exact Assurance-only shadow schema may have been installed by 20260923090525.
-- Fail rather than reuse an unrelated or malformed table.
DO $compat$
BEGIN
  IF to_regclass('public.recon_definition_business_units') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version::text='20260923090525')
      OR to_regclass('public.recon_definition_bu_grants') IS NULL
      OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.recon_definition_business_units') AND conname='recon_def_bu_recon_tenant_fk')
      OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.recon_definition_business_units') AND conname='recon_def_bu_bu_tenant_fk')
      OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.recon_definition_bu_grants') AND conname='recon_definition_bu_grants_owner_fk')
      OR EXISTS (SELECT 1 FROM public.recon_definition_business_units WHERE tenant_id <> 'aa5ed999-69eb-41a0-a9c6-fbb439efcffb'::uuid)
      OR EXISTS (SELECT 1 FROM public.recon_definition_bu_grants WHERE tenant_id <> 'aa5ed999-69eb-41a0-a9c6-fbb439efcffb'::uuid)
    THEN RAISE EXCEPTION 'Early reconciliation owner schema does not match the approved shadow backport'; END IF;
  END IF;
END
$compat$;

CREATE TABLE IF NOT EXISTS public.recon_definition_business_units (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  recon_id uuid NOT NULL,
  bu_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  PRIMARY KEY (tenant_id, recon_id, bu_id),
  CONSTRAINT recon_def_bu_recon_tenant_fk FOREIGN KEY (tenant_id, recon_id)
    REFERENCES public.recon_definitions(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT recon_def_bu_bu_tenant_fk FOREIGN KEY (tenant_id, bu_id)
    REFERENCES public.business_units(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX recon_definition_business_units_bu_idx
  ON public.recon_definition_business_units(tenant_id, bu_id, recon_id);

CREATE TABLE public.recon_definition_business_unit_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL,
  recon_id uuid NOT NULL,
  bu_id uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('INSERT', 'DELETE')),
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid,
  transaction_id bigint NOT NULL DEFAULT txid_current()
);
CREATE INDEX recon_definition_business_unit_audit_recon_idx
  ON public.recon_definition_business_unit_audit(tenant_id, recon_id, changed_at DESC);

CREATE TABLE IF NOT EXISTS public.recon_definition_bu_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  recon_id uuid NOT NULL,
  bu_id uuid NOT NULL,
  principal_type text NOT NULL CHECK (principal_type IN ('user', 'group')),
  principal_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('view', 'read', 'run', 'edit', 'approve')),
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid,
  CONSTRAINT recon_definition_bu_grants_owner_fk FOREIGN KEY (tenant_id, recon_id, bu_id)
    REFERENCES public.recon_definition_business_units(tenant_id, recon_id, bu_id) ON DELETE RESTRICT,
  CONSTRAINT recon_definition_bu_grants_unique UNIQUE
    (tenant_id, recon_id, bu_id, principal_type, principal_id, action)
);
CREATE INDEX recon_definition_bu_grants_principal_idx
  ON public.recon_definition_bu_grants(tenant_id, principal_type, principal_id, action, recon_id);
CREATE INDEX recon_definition_bu_grants_recon_action_idx
  ON public.recon_definition_bu_grants(tenant_id, recon_id, action, bu_id);

CREATE OR REPLACE FUNCTION public.validate_recon_definition_bu_grant()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.principal_type = 'user' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = NEW.tenant_id AND tm.user_id = NEW.principal_id AND tm.active
    ) THEN
      RAISE EXCEPTION 'reconciliation grant user must be an active member of the same tenant';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM public.tenant_groups g WHERE g.id = NEW.principal_id AND g.tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'reconciliation grant group must belong to the same tenant';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER recon_definition_bu_grant_validate
  BEFORE INSERT OR UPDATE ON public.recon_definition_bu_grants
  FOR EACH ROW EXECUTE FUNCTION public.validate_recon_definition_bu_grant();

CREATE OR REPLACE FUNCTION public.guard_recon_multi_bu_owner_mapping()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant uuid; v_recon uuid; v_bu uuid;
BEGIN
  v_tenant := COALESCE(NEW.tenant_id, OLD.tenant_id);
  v_recon := COALESCE(NEW.recon_id, OLD.recon_id);
  v_bu := COALESCE(NEW.bu_id, OLD.bu_id);
  IF TG_OP = 'DELETE' AND EXISTS (
    SELECT 1 FROM public.recon_definitions d
    WHERE d.id = OLD.recon_id AND d.tenant_id = OLD.tenant_id AND d.multi_bu_governed
      AND (SELECT count(*) FROM public.recon_definition_business_units m
           WHERE m.tenant_id = OLD.tenant_id AND m.recon_id = OLD.recon_id) = 0
  ) THEN
    RAISE EXCEPTION 'governed reconciliation must retain at least one owning business unit';
  END IF;
  INSERT INTO public.recon_definition_business_unit_audit
    (tenant_id, recon_id, bu_id, operation, changed_by)
  VALUES (v_tenant, v_recon, v_bu, TG_OP, auth.uid());
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER recon_definition_business_units_audit
  AFTER INSERT OR DELETE ON public.recon_definition_business_units
  FOR EACH ROW EXECUTE FUNCTION public.guard_recon_multi_bu_owner_mapping();

CREATE OR REPLACE FUNCTION public.reject_recon_owner_mapping_update()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'reconciliation owner mappings are immutable; replace by audited delete and insert';
END $$;
CREATE TRIGGER recon_definition_business_units_immutable
  BEFORE UPDATE ON public.recon_definition_business_units
  FOR EACH ROW EXECUTE FUNCTION public.reject_recon_owner_mapping_update();

CREATE OR REPLACE FUNCTION public.reject_recon_owner_audit_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'reconciliation owner mapping audit is immutable';
END $$;
CREATE TRIGGER recon_definition_business_unit_audit_immutable
  BEFORE UPDATE OR DELETE ON public.recon_definition_business_unit_audit
  FOR EACH ROW EXECUTE FUNCTION public.reject_recon_owner_audit_mutation();

CREATE OR REPLACE FUNCTION public.require_recon_multi_bu_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.multi_bu_governed AND NOT EXISTS (
    SELECT 1 FROM public.recon_definition_business_units m
    WHERE m.tenant_id = NEW.tenant_id AND m.recon_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'governed reconciliation requires at least one owning business unit';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER recon_definitions_require_multi_bu_owner
  BEFORE INSERT OR UPDATE OF multi_bu_governed ON public.recon_definitions
  FOR EACH ROW EXECUTE FUNCTION public.require_recon_multi_bu_owner();

-- These tables are intentionally unavailable to authenticated callers until a later
-- enforcement migration supplies reviewed RLS and helper policies.
ALTER TABLE public.recon_definition_business_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recon_definition_business_unit_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recon_definition_bu_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.recon_definition_business_units,
  public.recon_definition_business_unit_audit, public.recon_definition_bu_grants FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.recon_definition_business_units,
  public.recon_definition_business_unit_audit, public.recon_definition_bu_grants TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.recon_definition_business_unit_audit_id_seq TO service_role;
