-- Shadow-only multi-BU ownership/grant metadata for ingestion and Data Prep resources.
-- No legacy resource rows are mapped and no existing resource RLS/API policy is changed.

CREATE TABLE public.data_resource_business_unit_owners (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  resource_type text NOT NULL CHECK (resource_type IN (
    'data_source', 'db_connection', 'inline_api_source', 'erp_connection', 'file_watcher',
    'aidp_template', 'aidp_document', 'reference_table', 'data_prep_pipeline'
  )),
  resource_id uuid NOT NULL,
  bu_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  PRIMARY KEY (tenant_id, resource_type, resource_id, bu_id),
  CONSTRAINT data_resource_owner_bu_tenant_fk FOREIGN KEY (tenant_id, bu_id)
    REFERENCES public.business_units(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX data_resource_owner_bu_idx
  ON public.data_resource_business_unit_owners(tenant_id, bu_id, resource_type, resource_id);

CREATE TABLE public.data_resource_owner_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid NOT NULL,
  bu_id uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('INSERT', 'DELETE')),
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid,
  transaction_id bigint NOT NULL DEFAULT txid_current()
);
CREATE INDEX data_resource_owner_audit_resource_idx
  ON public.data_resource_owner_audit(tenant_id, resource_type, resource_id, changed_at DESC);

CREATE TABLE public.data_resource_bu_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid NOT NULL,
  bu_id uuid NOT NULL,
  principal_type text NOT NULL CHECK (principal_type IN ('user', 'group')),
  principal_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('view', 'ingest', 'run', 'edit', 'approve', 'manage')),
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid,
  CONSTRAINT data_resource_bu_grant_owner_fk FOREIGN KEY
    (tenant_id, resource_type, resource_id, bu_id)
    REFERENCES public.data_resource_business_unit_owners(tenant_id, resource_type, resource_id, bu_id)
    ON DELETE RESTRICT,
  CONSTRAINT data_resource_bu_grant_unique UNIQUE
    (tenant_id, resource_type, resource_id, bu_id, principal_type, principal_id, action)
);
CREATE INDEX data_resource_bu_grant_principal_idx
  ON public.data_resource_bu_grants(tenant_id, principal_type, principal_id, action, resource_type, resource_id);

CREATE TABLE public.data_resource_grant_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid NOT NULL,
  bu_id uuid NOT NULL,
  principal_type text NOT NULL,
  principal_id uuid NOT NULL,
  action text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('GRANT', 'REVOKE')),
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid,
  transaction_id bigint NOT NULL DEFAULT txid_current()
);
CREATE INDEX data_resource_grant_audit_resource_idx
  ON public.data_resource_grant_audit(tenant_id, resource_type, resource_id, changed_at DESC);

CREATE OR REPLACE FUNCTION public.validate_data_resource_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_table text; v_exists boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.business_units bu
    WHERE bu.tenant_id = NEW.tenant_id AND bu.id = NEW.bu_id AND NOT bu.is_archived
  ) THEN RAISE EXCEPTION 'owning business unit must be active in the same tenant'; END IF;
  v_table := CASE NEW.resource_type
    WHEN 'data_source' THEN 'workspace_data_sources'
    WHEN 'db_connection' THEN 'rekon_db_connections'
    WHEN 'inline_api_source' THEN 'rekon_inline_api_sources'
    WHEN 'erp_connection' THEN 'erp_connector_configs'
    WHEN 'file_watcher' THEN 'data_watchers'
    WHEN 'aidp_template' THEN 'aidp_templates'
    WHEN 'aidp_document' THEN 'aidp_documents'
    WHEN 'reference_table' THEN 'reference_data_tables'
    WHEN 'data_prep_pipeline' THEN 'data_prep_pipelines'
    ELSE NULL
  END;
  IF v_table IS NULL THEN RAISE EXCEPTION 'unsupported data resource type'; END IF;
  EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE id = $1 AND tenant_id = $2)', v_table)
    INTO v_exists USING NEW.resource_id, NEW.tenant_id;
  IF NOT v_exists THEN RAISE EXCEPTION 'resource must exist in the same tenant'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER data_resource_owner_validate
  BEFORE INSERT OR UPDATE ON public.data_resource_business_unit_owners
  FOR EACH ROW EXECUTE FUNCTION public.validate_data_resource_owner();

CREATE OR REPLACE FUNCTION public.reject_data_resource_owner_update()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'data resource owner mappings are immutable; replace by audited delete and insert'; END $$;
CREATE TRIGGER data_resource_owner_immutable
  BEFORE UPDATE ON public.data_resource_business_unit_owners
  FOR EACH ROW EXECUTE FUNCTION public.reject_data_resource_owner_update();

CREATE OR REPLACE FUNCTION public.validate_data_resource_grant()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.principal_type = 'user' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = NEW.tenant_id AND tm.user_id = NEW.principal_id AND tm.active
    ) THEN RAISE EXCEPTION 'grant user must be an active member of the same tenant'; END IF;
  ELSIF NOT EXISTS (
    SELECT 1 FROM public.tenant_groups g
    WHERE g.tenant_id = NEW.tenant_id AND g.id = NEW.principal_id
  ) THEN RAISE EXCEPTION 'grant group must belong to the same tenant';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER data_resource_grant_validate
  BEFORE INSERT OR UPDATE ON public.data_resource_bu_grants
  FOR EACH ROW EXECUTE FUNCTION public.validate_data_resource_grant();

CREATE OR REPLACE FUNCTION public.reject_data_resource_grant_update()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'data resource grants are immutable; revoke and regrant'; END $$;
CREATE TRIGGER data_resource_grant_immutable
  BEFORE UPDATE ON public.data_resource_bu_grants
  FOR EACH ROW EXECUTE FUNCTION public.reject_data_resource_grant_update();

CREATE OR REPLACE FUNCTION public.audit_data_resource_owner_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.data_resource_business_unit_owners%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  INSERT INTO public.data_resource_owner_audit
    (tenant_id, resource_type, resource_id, bu_id, operation, changed_by)
  VALUES (r.tenant_id, r.resource_type, r.resource_id, r.bu_id, TG_OP, auth.uid());
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER data_resource_owner_audit_change
  AFTER INSERT OR DELETE ON public.data_resource_business_unit_owners
  FOR EACH ROW EXECUTE FUNCTION public.audit_data_resource_owner_change();

CREATE OR REPLACE FUNCTION public.audit_data_resource_grant_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.data_resource_bu_grants%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  INSERT INTO public.data_resource_grant_audit
    (tenant_id, resource_type, resource_id, bu_id, principal_type, principal_id,
     action, operation, changed_by)
  VALUES (r.tenant_id, r.resource_type, r.resource_id, r.bu_id, r.principal_type,
          r.principal_id, r.action, CASE WHEN TG_OP = 'DELETE' THEN 'REVOKE' ELSE 'GRANT' END, auth.uid());
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER data_resource_grant_audit_change
  AFTER INSERT OR DELETE ON public.data_resource_bu_grants
  FOR EACH ROW EXECUTE FUNCTION public.audit_data_resource_grant_change();

CREATE OR REPLACE FUNCTION public.reject_data_resource_audit_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'data resource authorization audit is immutable'; END $$;
CREATE TRIGGER data_resource_owner_audit_immutable
  BEFORE UPDATE OR DELETE ON public.data_resource_owner_audit
  FOR EACH ROW EXECUTE FUNCTION public.reject_data_resource_audit_mutation();
CREATE TRIGGER data_resource_grant_audit_immutable
  BEFORE UPDATE OR DELETE ON public.data_resource_grant_audit
  FOR EACH ROW EXECUTE FUNCTION public.reject_data_resource_audit_mutation();

-- Shadow ledger only: callers cannot inspect or mutate it until reviewed admin/evaluator
-- RPCs and RLS are added. Existing resource policies and legacy access remain authoritative.
ALTER TABLE public.data_resource_business_unit_owners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_resource_owner_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_resource_bu_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_resource_grant_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.data_resource_business_unit_owners, public.data_resource_owner_audit,
  public.data_resource_bu_grants, public.data_resource_grant_audit FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.data_resource_business_unit_owners, public.data_resource_owner_audit,
  public.data_resource_bu_grants, public.data_resource_grant_audit TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.data_resource_owner_audit_id_seq,
  public.data_resource_grant_audit_id_seq TO service_role;
