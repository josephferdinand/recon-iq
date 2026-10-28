-- Shadow-only typed resource registry. This does not replace existing RLS or callers.
-- Root rows are immutable by tenant once registered; no legacy resources are mapped.

CREATE TABLE public.data_resource_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  resource_type text NOT NULL CHECK (resource_type IN (
    'data_source', 'db_connection', 'inline_api_source', 'erp_connection', 'file_watcher',
    'aidp_template', 'aidp_document', 'reference_table', 'data_prep_pipeline'
  )),
  data_source_id uuid REFERENCES public.workspace_data_sources(id) ON DELETE RESTRICT,
  db_connection_id uuid REFERENCES public.rekon_db_connections(id) ON DELETE RESTRICT,
  inline_api_source_id uuid REFERENCES public.rekon_inline_api_sources(id) ON DELETE RESTRICT,
  erp_connection_id uuid REFERENCES public.erp_connector_configs(id) ON DELETE RESTRICT,
  file_watcher_id uuid REFERENCES public.data_watchers(id) ON DELETE RESTRICT,
  aidp_template_id uuid REFERENCES public.aidp_templates(id) ON DELETE RESTRICT,
  aidp_document_id uuid REFERENCES public.aidp_documents(id) ON DELETE RESTRICT,
  reference_table_id uuid REFERENCES public.reference_data_tables(id) ON DELETE RESTRICT,
  data_prep_pipeline_id uuid REFERENCES public.data_prep_pipelines(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CONSTRAINT data_resource_registry_tenant_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT data_resource_registry_exact_root_ck CHECK (
    (resource_type = 'data_source' AND data_source_id IS NOT NULL AND num_nonnulls(db_connection_id, inline_api_source_id, erp_connection_id, file_watcher_id, aidp_template_id, aidp_document_id, reference_table_id, data_prep_pipeline_id) = 0) OR
    (resource_type = 'db_connection' AND db_connection_id IS NOT NULL AND num_nonnulls(data_source_id, inline_api_source_id, erp_connection_id, file_watcher_id, aidp_template_id, aidp_document_id, reference_table_id, data_prep_pipeline_id) = 0) OR
    (resource_type = 'inline_api_source' AND inline_api_source_id IS NOT NULL AND num_nonnulls(data_source_id, db_connection_id, erp_connection_id, file_watcher_id, aidp_template_id, aidp_document_id, reference_table_id, data_prep_pipeline_id) = 0) OR
    (resource_type = 'erp_connection' AND erp_connection_id IS NOT NULL AND num_nonnulls(data_source_id, db_connection_id, inline_api_source_id, file_watcher_id, aidp_template_id, aidp_document_id, reference_table_id, data_prep_pipeline_id) = 0) OR
    (resource_type = 'file_watcher' AND file_watcher_id IS NOT NULL AND num_nonnulls(data_source_id, db_connection_id, inline_api_source_id, erp_connection_id, aidp_template_id, aidp_document_id, reference_table_id, data_prep_pipeline_id) = 0) OR
    (resource_type = 'aidp_template' AND aidp_template_id IS NOT NULL AND num_nonnulls(data_source_id, db_connection_id, inline_api_source_id, erp_connection_id, file_watcher_id, aidp_document_id, reference_table_id, data_prep_pipeline_id) = 0) OR
    (resource_type = 'aidp_document' AND aidp_document_id IS NOT NULL AND num_nonnulls(data_source_id, db_connection_id, inline_api_source_id, erp_connection_id, file_watcher_id, aidp_template_id, reference_table_id, data_prep_pipeline_id) = 0) OR
    (resource_type = 'reference_table' AND reference_table_id IS NOT NULL AND num_nonnulls(data_source_id, db_connection_id, inline_api_source_id, erp_connection_id, file_watcher_id, aidp_template_id, aidp_document_id, data_prep_pipeline_id) = 0) OR
    (resource_type = 'data_prep_pipeline' AND data_prep_pipeline_id IS NOT NULL AND num_nonnulls(data_source_id, db_connection_id, inline_api_source_id, erp_connection_id, file_watcher_id, aidp_template_id, aidp_document_id, reference_table_id) = 0)
  )
);
CREATE UNIQUE INDEX data_resource_registry_data_source_uq ON public.data_resource_registry(data_source_id) WHERE data_source_id IS NOT NULL;
CREATE UNIQUE INDEX data_resource_registry_db_connection_uq ON public.data_resource_registry(db_connection_id) WHERE db_connection_id IS NOT NULL;
CREATE UNIQUE INDEX data_resource_registry_inline_api_uq ON public.data_resource_registry(inline_api_source_id) WHERE inline_api_source_id IS NOT NULL;
CREATE UNIQUE INDEX data_resource_registry_erp_connection_uq ON public.data_resource_registry(erp_connection_id) WHERE erp_connection_id IS NOT NULL;
CREATE UNIQUE INDEX data_resource_registry_file_watcher_uq ON public.data_resource_registry(file_watcher_id) WHERE file_watcher_id IS NOT NULL;
CREATE UNIQUE INDEX data_resource_registry_aidp_template_uq ON public.data_resource_registry(aidp_template_id) WHERE aidp_template_id IS NOT NULL;
CREATE UNIQUE INDEX data_resource_registry_aidp_document_uq ON public.data_resource_registry(aidp_document_id) WHERE aidp_document_id IS NOT NULL;
CREATE UNIQUE INDEX data_resource_registry_reference_table_uq ON public.data_resource_registry(reference_table_id) WHERE reference_table_id IS NOT NULL;
CREATE UNIQUE INDEX data_resource_registry_data_prep_pipeline_uq ON public.data_resource_registry(data_prep_pipeline_id) WHERE data_prep_pipeline_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.validate_data_resource_registry_root()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_root_tenant uuid; v_resource_uuid uuid; v_lock_key bigint;
BEGIN
  v_resource_uuid := CASE NEW.resource_type
    WHEN 'data_source' THEN NEW.data_source_id
    WHEN 'db_connection' THEN NEW.db_connection_id
    WHEN 'inline_api_source' THEN NEW.inline_api_source_id
    WHEN 'erp_connection' THEN NEW.erp_connection_id
    WHEN 'file_watcher' THEN NEW.file_watcher_id
    WHEN 'aidp_template' THEN NEW.aidp_template_id
    WHEN 'aidp_document' THEN NEW.aidp_document_id
    WHEN 'reference_table' THEN NEW.reference_table_id
    WHEN 'data_prep_pipeline' THEN NEW.data_prep_pipeline_id
  END;
  v_lock_key := pg_catalog.hashtextextended('fvi-resource:' || NEW.resource_type || ':' || v_resource_uuid::text, 0);
  PERFORM pg_catalog.pg_advisory_xact_lock(v_lock_key);
  CASE NEW.resource_type
    WHEN 'data_source' THEN SELECT tenant_id INTO v_root_tenant FROM public.workspace_data_sources WHERE id = NEW.data_source_id FOR SHARE;
    WHEN 'db_connection' THEN SELECT tenant_id INTO v_root_tenant FROM public.rekon_db_connections WHERE id = NEW.db_connection_id FOR SHARE;
    WHEN 'inline_api_source' THEN SELECT tenant_id INTO v_root_tenant FROM public.rekon_inline_api_sources WHERE id = NEW.inline_api_source_id FOR SHARE;
    WHEN 'erp_connection' THEN SELECT tenant_id INTO v_root_tenant FROM public.erp_connector_configs WHERE id = NEW.erp_connection_id FOR SHARE;
    WHEN 'file_watcher' THEN SELECT tenant_id INTO v_root_tenant FROM public.data_watchers WHERE id = NEW.file_watcher_id FOR SHARE;
    WHEN 'aidp_template' THEN SELECT tenant_id INTO v_root_tenant FROM public.aidp_templates WHERE id = NEW.aidp_template_id FOR SHARE;
    WHEN 'aidp_document' THEN SELECT tenant_id INTO v_root_tenant FROM public.aidp_documents WHERE id = NEW.aidp_document_id FOR SHARE;
    WHEN 'reference_table' THEN SELECT tenant_id INTO v_root_tenant FROM public.reference_data_tables WHERE id = NEW.reference_table_id FOR SHARE;
    WHEN 'data_prep_pipeline' THEN SELECT tenant_id INTO v_root_tenant FROM public.data_prep_pipelines WHERE id = NEW.data_prep_pipeline_id FOR SHARE;
  END CASE;
  IF v_root_tenant IS NULL OR v_root_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'resource root must exist in the declared tenant';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER data_resource_registry_root_validate
  BEFORE INSERT OR UPDATE ON public.data_resource_registry
  FOR EACH ROW EXECUTE FUNCTION public.validate_data_resource_registry_root();

CREATE OR REPLACE FUNCTION public.reject_data_resource_registry_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN RAISE EXCEPTION 'typed data resource registry rows are retained and immutable'; END $$;
CREATE TRIGGER data_resource_registry_immutable
  BEFORE UPDATE OR DELETE ON public.data_resource_registry
  FOR EACH ROW EXECUTE FUNCTION public.reject_data_resource_registry_mutation();

-- Once registered, a root cannot be moved to a different tenant. The matching
-- advisory key serializes this check with registry insertion.
CREATE OR REPLACE FUNCTION public.prevent_registered_resource_tenant_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_resource_type text; v_column text; v_lock_key bigint; v_registered boolean;
BEGIN
  IF NEW.tenant_id IS NOT DISTINCT FROM OLD.tenant_id THEN RETURN NEW; END IF;
  CASE TG_TABLE_NAME
    WHEN 'workspace_data_sources' THEN v_resource_type := 'data_source'; v_column := 'data_source_id';
    WHEN 'rekon_db_connections' THEN v_resource_type := 'db_connection'; v_column := 'db_connection_id';
    WHEN 'rekon_inline_api_sources' THEN v_resource_type := 'inline_api_source'; v_column := 'inline_api_source_id';
    WHEN 'erp_connector_configs' THEN v_resource_type := 'erp_connection'; v_column := 'erp_connection_id';
    WHEN 'data_watchers' THEN v_resource_type := 'file_watcher'; v_column := 'file_watcher_id';
    WHEN 'aidp_templates' THEN v_resource_type := 'aidp_template'; v_column := 'aidp_template_id';
    WHEN 'aidp_documents' THEN v_resource_type := 'aidp_document'; v_column := 'aidp_document_id';
    WHEN 'reference_data_tables' THEN v_resource_type := 'reference_table'; v_column := 'reference_table_id';
    WHEN 'data_prep_pipelines' THEN v_resource_type := 'data_prep_pipeline'; v_column := 'data_prep_pipeline_id';
    WHEN 'tenant_groups' THEN v_resource_type := 'principal_group'; v_column := NULL;
  END CASE;
  IF v_resource_type = 'principal_group' THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('fvi-principal-group:' || OLD.id::text, 0));
    IF EXISTS (SELECT 1 FROM public.data_resource_registry_grants WHERE principal_group_id = OLD.id) THEN
      RAISE EXCEPTION 'tenant cannot change while the group has retained resource grants';
    END IF;
    RETURN NEW;
  END IF;
  v_lock_key := pg_catalog.hashtextextended('fvi-resource:' || v_resource_type || ':' || OLD.id::text, 0);
  PERFORM pg_catalog.pg_advisory_xact_lock(v_lock_key);
  EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.data_resource_registry WHERE %I = $1)', v_column)
    INTO v_registered USING OLD.id;
  IF v_registered THEN RAISE EXCEPTION 'tenant cannot change for a registered resource'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER data_resource_source_tenant_guard BEFORE UPDATE OF tenant_id ON public.workspace_data_sources FOR EACH ROW EXECUTE FUNCTION public.prevent_registered_resource_tenant_change();
CREATE TRIGGER data_resource_db_connection_tenant_guard BEFORE UPDATE OF tenant_id ON public.rekon_db_connections FOR EACH ROW EXECUTE FUNCTION public.prevent_registered_resource_tenant_change();
CREATE TRIGGER data_resource_inline_api_tenant_guard BEFORE UPDATE OF tenant_id ON public.rekon_inline_api_sources FOR EACH ROW EXECUTE FUNCTION public.prevent_registered_resource_tenant_change();
CREATE TRIGGER data_resource_erp_tenant_guard BEFORE UPDATE OF tenant_id ON public.erp_connector_configs FOR EACH ROW EXECUTE FUNCTION public.prevent_registered_resource_tenant_change();
CREATE TRIGGER data_resource_watcher_tenant_guard BEFORE UPDATE OF tenant_id ON public.data_watchers FOR EACH ROW EXECUTE FUNCTION public.prevent_registered_resource_tenant_change();
CREATE TRIGGER data_resource_aidp_template_tenant_guard BEFORE UPDATE OF tenant_id ON public.aidp_templates FOR EACH ROW EXECUTE FUNCTION public.prevent_registered_resource_tenant_change();
CREATE TRIGGER data_resource_aidp_document_tenant_guard BEFORE UPDATE OF tenant_id ON public.aidp_documents FOR EACH ROW EXECUTE FUNCTION public.prevent_registered_resource_tenant_change();
CREATE TRIGGER data_resource_reference_table_tenant_guard BEFORE UPDATE OF tenant_id ON public.reference_data_tables FOR EACH ROW EXECUTE FUNCTION public.prevent_registered_resource_tenant_change();
CREATE TRIGGER data_resource_data_prep_tenant_guard BEFORE UPDATE OF tenant_id ON public.data_prep_pipelines FOR EACH ROW EXECUTE FUNCTION public.prevent_registered_resource_tenant_change();
CREATE TRIGGER data_resource_group_tenant_guard BEFORE UPDATE OF tenant_id ON public.tenant_groups FOR EACH ROW EXECUTE FUNCTION public.prevent_registered_resource_tenant_change();

CREATE TABLE public.data_resource_registry_owner_bu (
  tenant_id uuid NOT NULL,
  registry_id uuid NOT NULL,
  bu_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  PRIMARY KEY (tenant_id, registry_id, bu_id),
  CONSTRAINT data_resource_registry_owner_resource_fk FOREIGN KEY (tenant_id, registry_id)
    REFERENCES public.data_resource_registry(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT data_resource_registry_owner_bu_fk FOREIGN KEY (tenant_id, bu_id)
    REFERENCES public.business_units(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX data_resource_registry_owner_bu_idx
  ON public.data_resource_registry_owner_bu(tenant_id, bu_id, registry_id);

CREATE TABLE public.data_resource_registry_owner_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL,
  registry_id uuid NOT NULL,
  bu_id uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('INSERT', 'DELETE')),
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid,
  transaction_id bigint NOT NULL DEFAULT txid_current()
);
CREATE INDEX data_resource_registry_owner_audit_idx
  ON public.data_resource_registry_owner_audit(tenant_id, registry_id, changed_at DESC);

CREATE OR REPLACE FUNCTION public.validate_data_resource_registry_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.business_units bu
    WHERE bu.id = NEW.bu_id AND bu.tenant_id = NEW.tenant_id AND NOT bu.is_archived
  ) THEN RAISE EXCEPTION 'owner business unit must be active in the same tenant'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER data_resource_registry_owner_validate
  BEFORE INSERT OR UPDATE ON public.data_resource_registry_owner_bu
  FOR EACH ROW EXECUTE FUNCTION public.validate_data_resource_registry_owner();
CREATE OR REPLACE FUNCTION public.reject_data_resource_registry_owner_update()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN RAISE EXCEPTION 'resource owner mappings are immutable; change by audited delete and insert'; END $$;
CREATE TRIGGER data_resource_registry_owner_immutable
  BEFORE UPDATE ON public.data_resource_registry_owner_bu
  FOR EACH ROW EXECUTE FUNCTION public.reject_data_resource_registry_owner_update();
CREATE OR REPLACE FUNCTION public.audit_data_resource_registry_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r public.data_resource_registry_owner_bu%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  INSERT INTO public.data_resource_registry_owner_audit(tenant_id, registry_id, bu_id, operation, changed_by)
  VALUES (r.tenant_id, r.registry_id, r.bu_id, TG_OP, auth.uid());
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER data_resource_registry_owner_audit_change
  AFTER INSERT OR DELETE ON public.data_resource_registry_owner_bu
  FOR EACH ROW EXECUTE FUNCTION public.audit_data_resource_registry_owner();

CREATE TABLE public.data_resource_registry_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  registry_id uuid NOT NULL,
  bu_id uuid NOT NULL,
  principal_type text NOT NULL CHECK (principal_type IN ('user', 'group')),
  principal_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  principal_group_id uuid REFERENCES public.tenant_groups(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('view', 'ingest', 'run', 'edit', 'manage', 'approve')),
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid,
  CONSTRAINT data_resource_registry_grant_owner_fk FOREIGN KEY (tenant_id, registry_id, bu_id)
    REFERENCES public.data_resource_registry_owner_bu(tenant_id, registry_id, bu_id) ON DELETE RESTRICT,
  CONSTRAINT data_resource_registry_grant_principal_ck CHECK (
    (principal_type = 'user' AND principal_user_id IS NOT NULL AND principal_group_id IS NULL) OR
    (principal_type = 'group' AND principal_group_id IS NOT NULL AND principal_user_id IS NULL)
  )
);
CREATE UNIQUE INDEX data_resource_registry_user_grant_uq
  ON public.data_resource_registry_grants(tenant_id, registry_id, bu_id, principal_user_id, action)
  WHERE principal_type = 'user';
CREATE UNIQUE INDEX data_resource_registry_group_grant_uq
  ON public.data_resource_registry_grants(tenant_id, registry_id, bu_id, principal_group_id, action)
  WHERE principal_type = 'group';
CREATE INDEX data_resource_registry_grant_principal_idx
  ON public.data_resource_registry_grants(tenant_id, principal_type, principal_user_id, principal_group_id, action);

CREATE TABLE public.data_resource_registry_grant_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL,
  registry_id uuid NOT NULL,
  bu_id uuid NOT NULL,
  principal_type text NOT NULL,
  principal_user_id uuid,
  principal_group_id uuid,
  action text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('GRANT', 'REVOKE')),
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid,
  transaction_id bigint NOT NULL DEFAULT txid_current()
);
CREATE INDEX data_resource_registry_grant_audit_idx
  ON public.data_resource_registry_grant_audit(tenant_id, registry_id, changed_at DESC);

CREATE OR REPLACE FUNCTION public.validate_data_resource_registry_grant()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_group_tenant uuid;
BEGIN
  IF NEW.principal_type = 'user' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = NEW.tenant_id AND tm.user_id = NEW.principal_user_id AND tm.active
    ) THEN RAISE EXCEPTION 'grant user must be an active member of the same tenant'; END IF;
  ELSE
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('fvi-principal-group:' || NEW.principal_group_id::text, 0)
    );
    SELECT g.tenant_id INTO v_group_tenant
    FROM public.tenant_groups g WHERE g.id = NEW.principal_group_id FOR SHARE;
    IF v_group_tenant IS NULL OR v_group_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'grant group must belong to the same tenant';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER data_resource_registry_grant_validate
  BEFORE INSERT OR UPDATE ON public.data_resource_registry_grants
  FOR EACH ROW EXECUTE FUNCTION public.validate_data_resource_registry_grant();
CREATE OR REPLACE FUNCTION public.reject_data_resource_registry_grant_update()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN RAISE EXCEPTION 'resource grants are immutable; revoke and regrant'; END $$;
CREATE TRIGGER data_resource_registry_grant_immutable
  BEFORE UPDATE ON public.data_resource_registry_grants
  FOR EACH ROW EXECUTE FUNCTION public.reject_data_resource_registry_grant_update();
CREATE OR REPLACE FUNCTION public.audit_data_resource_registry_grant()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r public.data_resource_registry_grants%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  INSERT INTO public.data_resource_registry_grant_audit
    (tenant_id, registry_id, bu_id, principal_type, principal_user_id, principal_group_id,
     action, operation, changed_by)
  VALUES (r.tenant_id, r.registry_id, r.bu_id, r.principal_type, r.principal_user_id,
          r.principal_group_id, r.action, CASE WHEN TG_OP = 'DELETE' THEN 'REVOKE' ELSE 'GRANT' END, auth.uid());
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER data_resource_registry_grant_audit_change
  AFTER INSERT OR DELETE ON public.data_resource_registry_grants
  FOR EACH ROW EXECUTE FUNCTION public.audit_data_resource_registry_grant();

CREATE OR REPLACE FUNCTION public.reject_data_resource_registry_audit_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN RAISE EXCEPTION 'resource authorization audit is immutable'; END $$;
CREATE TRIGGER data_resource_registry_owner_audit_immutable
  BEFORE UPDATE OR DELETE ON public.data_resource_registry_owner_audit
  FOR EACH ROW EXECUTE FUNCTION public.reject_data_resource_registry_audit_mutation();
CREATE TRIGGER data_resource_registry_grant_audit_immutable
  BEFORE UPDATE OR DELETE ON public.data_resource_registry_grant_audit
  FOR EACH ROW EXECUTE FUNCTION public.reject_data_resource_registry_audit_mutation();

-- Shadow decision helper. Approval is denied until lifecycle RPCs can supply a
-- persisted request-maker identity and enforce maker/checker separation there.
CREATE OR REPLACE FUNCTION private.data_resource_shadow_allows_actor(
  _actor uuid, _registry_id uuid, _action text
)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $function$
  WITH target AS (
    SELECT r.id, r.tenant_id
    FROM public.data_resource_registry r
    WHERE r.id = _registry_id
      AND _action IN ('view', 'ingest', 'run', 'edit', 'manage', 'approve')
      AND EXISTS (
        SELECT 1 FROM public.data_resource_registry_owner_bu owner_link
        JOIN public.business_units owner_bu ON owner_bu.id = owner_link.bu_id
          AND owner_bu.tenant_id = owner_link.tenant_id AND NOT owner_bu.is_archived
        WHERE owner_link.tenant_id = r.tenant_id AND owner_link.registry_id = r.id
      )
  ), active_actor AS (
    SELECT t.tenant_id, tm.role
    FROM target t
    JOIN public.tenant_members tm ON tm.tenant_id = t.tenant_id AND tm.user_id = _actor AND tm.active
  ), admin_override AS (
    SELECT 1 FROM active_actor WHERE role = 'tenant_admin'::public.tenant_role
  ), direct_grant AS (
    SELECT 1
    FROM target t
    JOIN active_actor aa ON aa.tenant_id = t.tenant_id
    JOIN public.data_resource_registry_owner_bu o ON o.tenant_id = t.tenant_id AND o.registry_id = t.id
    JOIN public.business_units target_bu ON target_bu.id = o.bu_id AND target_bu.tenant_id = t.tenant_id AND NOT target_bu.is_archived
    JOIN public.data_resource_registry_grants g ON g.tenant_id = t.tenant_id AND g.registry_id = t.id AND g.bu_id = o.bu_id
    WHERE g.action = _action AND g.principal_type = 'user' AND g.principal_user_id = _actor
      AND EXISTS (
        SELECT 1 FROM public.bu_user_assignments ua
        JOIN public.business_units assigned_bu ON assigned_bu.id = ua.bu_id AND assigned_bu.tenant_id = ua.tenant_id AND NOT assigned_bu.is_archived
        WHERE ua.tenant_id = t.tenant_id AND ua.user_id = _actor
          AND (assigned_bu.id = target_bu.id OR (ua.inherit_descendants AND target_bu.path <@ assigned_bu.path))
      )
  ), group_grant AS (
    SELECT 1
    FROM target t
    JOIN active_actor aa ON aa.tenant_id = t.tenant_id
    JOIN public.data_resource_registry_owner_bu o ON o.tenant_id = t.tenant_id AND o.registry_id = t.id
    JOIN public.business_units target_bu ON target_bu.id = o.bu_id AND target_bu.tenant_id = t.tenant_id AND NOT target_bu.is_archived
    JOIN public.data_resource_registry_grants g ON g.tenant_id = t.tenant_id AND g.registry_id = t.id AND g.bu_id = o.bu_id
    JOIN public.tenant_groups grant_group ON grant_group.id = g.principal_group_id AND grant_group.tenant_id = t.tenant_id
    JOIN public.tenant_group_members gm ON gm.group_id = grant_group.id AND gm.user_id = _actor
    WHERE g.action = _action AND g.principal_type = 'group'
      AND EXISTS (
        SELECT 1 FROM public.bu_group_assignments ga
        JOIN public.business_units assigned_bu ON assigned_bu.id = ga.bu_id AND assigned_bu.tenant_id = ga.tenant_id AND NOT assigned_bu.is_archived
        WHERE ga.tenant_id = t.tenant_id AND ga.group_id = grant_group.id
          AND (assigned_bu.id = target_bu.id OR (ga.inherit_descendants AND target_bu.path <@ assigned_bu.path))
      )
  )
  SELECT CASE
    WHEN _actor IS NULL OR _registry_id IS NULL OR _action NOT IN ('view', 'ingest', 'run', 'edit', 'manage', 'approve') THEN false
    WHEN NOT EXISTS (SELECT 1 FROM target) OR NOT EXISTS (SELECT 1 FROM active_actor) THEN false
    -- The generic ledger cannot prove a lifecycle request maker. Never let a
    -- grant or admin override substitute for workflow-specific SoD evidence.
    WHEN _action = 'approve' THEN false
    WHEN EXISTS (SELECT 1 FROM admin_override) THEN true
    ELSE EXISTS (SELECT 1 FROM direct_grant) OR EXISTS (SELECT 1 FROM group_grant)
  END
$function$;
REVOKE ALL ON FUNCTION private.data_resource_shadow_allows_actor(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.data_resource_shadow_allows_actor(uuid, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.data_resource_shadow_allows(_registry_id uuid, _action text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, private AS $function$
  SELECT private.data_resource_shadow_allows_actor(auth.uid(), _registry_id, _action)
$function$;
REVOKE ALL ON FUNCTION public.data_resource_shadow_allows(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.data_resource_shadow_allows(uuid, text) TO authenticated, service_role;
COMMENT ON FUNCTION public.data_resource_shadow_allows(uuid, text) IS
  'Shadow-only typed-resource decision helper; not connected to existing RLS or application callers. approve always denies until lifecycle-specific SoD request identity is supplied.';

ALTER TABLE public.data_resource_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_resource_registry_owner_bu ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_resource_registry_owner_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_resource_registry_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_resource_registry_grant_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.data_resource_registry, public.data_resource_registry_owner_bu,
  public.data_resource_registry_owner_audit, public.data_resource_registry_grants,
  public.data_resource_registry_grant_audit FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.data_resource_registry TO service_role;
GRANT SELECT, INSERT, DELETE ON public.data_resource_registry_owner_bu,
  public.data_resource_registry_grants TO service_role;

COMMENT ON TABLE public.data_resource_registry IS
  'Shadow-only typed FK-backed registry for nine resource roots; no legacy rows are mapped and existing policies remain authoritative.';
COMMENT ON TABLE public.data_resource_registry_owner_bu IS
  'Shadow-only owning BU links. Decisions fail closed when no active same-tenant owner BU is present.';
