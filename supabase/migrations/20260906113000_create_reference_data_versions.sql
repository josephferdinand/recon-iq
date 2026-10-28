-- Immutable, tenant-bound Reference Data version snapshots.
-- Publication functions follow separately; authenticated users receive read-only access.

CREATE TABLE public.reference_data_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  table_id uuid NOT NULL REFERENCES public.reference_data_tables(id) ON DELETE RESTRICT,
  version_number integer NOT NULL CHECK (version_number > 0),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','pending_approval','published','superseded','rejected')),
  effective_from date NOT NULL,
  effective_to date,
  row_count integer NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  content_sha256 text CHECK (content_sha256 IS NULL OR content_sha256 ~ '^[0-9a-f]{64}$'),
  change_note text NOT NULL CHECK (length(btrim(change_note)) BETWEEN 3 AND 1000),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_by uuid REFERENCES auth.users(id),
  submitted_at timestamptz,
  decided_by uuid REFERENCES auth.users(id),
  decided_at timestamptz,
  decision_reason text,
  published_at timestamptz,
  UNIQUE (table_id, version_number),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CHECK (submitted_by IS NULL OR submitted_by = created_by),
  CHECK (decided_by IS NULL OR decided_by <> created_by)
);

CREATE UNIQUE INDEX reference_data_versions_one_pending_uq
  ON public.reference_data_versions(table_id)
  WHERE status = 'pending_approval';
CREATE INDEX reference_data_versions_effective_idx
  ON public.reference_data_versions(table_id, effective_from, effective_to)
  WHERE status IN ('published','superseded');

ALTER TABLE public.reference_data_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reference_data_versions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.reference_data_versions TO authenticated;
GRANT ALL ON public.reference_data_versions TO service_role;
CREATE POLICY reference_data_versions_read ON public.reference_data_versions
  FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));

CREATE TABLE public.reference_data_version_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES public.reference_data_versions(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  table_id uuid NOT NULL REFERENCES public.reference_data_tables(id) ON DELETE CASCADE,
  row_data jsonb NOT NULL,
  key_hash text NOT NULL CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (version_id, key_hash)
);

CREATE INDEX reference_data_version_rows_table_idx
  ON public.reference_data_version_rows(table_id, version_id);
CREATE INDEX reference_data_version_rows_data_idx
  ON public.reference_data_version_rows USING GIN (row_data);

ALTER TABLE public.reference_data_version_rows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reference_data_version_rows FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.reference_data_version_rows TO authenticated;
GRANT ALL ON public.reference_data_version_rows TO service_role;
CREATE POLICY reference_data_version_rows_read ON public.reference_data_version_rows
  FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.tg_reference_data_version_row_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  version_tenant uuid;
  version_table uuid;
  version_status text;
  keys text[];
  key_payload jsonb;
BEGIN
  SELECT tenant_id, table_id, status
  INTO version_tenant, version_table, version_status
  FROM public.reference_data_versions
  WHERE id = NEW.version_id;

  IF version_tenant IS NULL
     OR version_tenant <> NEW.tenant_id
     OR version_table <> NEW.table_id THEN
    RAISE EXCEPTION 'Reference version row must belong to the same tenant and table';
  END IF;
  IF version_status <> 'draft' THEN
    RAISE EXCEPTION 'Reference version rows are immutable after submission';
  END IF;

  SELECT key_columns INTO keys
  FROM public.reference_data_tables
  WHERE id = NEW.table_id AND tenant_id = NEW.tenant_id;
  IF coalesce(array_length(keys, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Reference table must define at least one key column';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(keys) AS key_name
    WHERE NOT (NEW.row_data ? key_name)
       OR NEW.row_data -> key_name IS NULL
       OR btrim(NEW.row_data ->> key_name) = ''
  ) THEN
    RAISE EXCEPTION 'Reference version row is missing a required key value';
  END IF;

  SELECT jsonb_agg(NEW.row_data -> key_name ORDER BY ordinal)
  INTO key_payload
  FROM unnest(keys) WITH ORDINALITY AS ordered_keys(key_name, ordinal);
  NEW.key_hash := encode(digest(key_payload::text, 'sha256'), 'hex');
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_reference_data_version_row_integrity()
  FROM PUBLIC, anon, authenticated;
CREATE TRIGGER reference_data_version_rows_integrity
  BEFORE INSERT ON public.reference_data_version_rows
  FOR EACH ROW EXECUTE FUNCTION public.tg_reference_data_version_row_integrity();

CREATE OR REPLACE FUNCTION public.tg_reference_data_version_row_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Reference version rows are immutable';
END;
$$;

REVOKE ALL ON FUNCTION public.tg_reference_data_version_row_immutable()
  FROM PUBLIC, anon, authenticated;
CREATE TRIGGER reference_data_version_rows_immutable
  BEFORE UPDATE OR DELETE ON public.reference_data_version_rows
  FOR EACH ROW EXECUTE FUNCTION public.tg_reference_data_version_row_immutable();

ALTER TABLE public.reference_data_tables
  ADD COLUMN published_version_id uuid REFERENCES public.reference_data_versions(id) ON DELETE SET NULL;
ALTER TABLE public.reference_data_rows
  ADD COLUMN version_id uuid REFERENCES public.reference_data_versions(id) ON DELETE RESTRICT;
