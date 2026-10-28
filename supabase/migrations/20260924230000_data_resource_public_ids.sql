-- Concise, opaque, immutable tenant-facing identifiers for data-resource roots.
-- Generated IDs hash the internal UUID; public values do not expose it. The
-- tenant-scoped unique indexes fail closed if the 80-bit suffix ever collides.
-- Stored generated columns backfill existing records without issuing UPDATEs,
-- changing timestamps, touching ownership, or introducing counter races.

ALTER TABLE public.workspace_data_sources ADD COLUMN IF NOT EXISTS public_id text
  GENERATED ALWAYS AS ('FVI-DS-' || upper(substr(encode(digest(id::text,'sha256'),'hex'),1,20))) STORED;
ALTER TABLE public.workspace_data_source_uploads ADD COLUMN IF NOT EXISTS public_id text
  GENERATED ALWAYS AS ('FVI-UP-' || upper(substr(encode(digest(id::text,'sha256'),'hex'),1,20))) STORED;
ALTER TABLE public.data_source_schedules ADD COLUMN IF NOT EXISTS public_id text
  GENERATED ALWAYS AS ('FVI-SCH-' || upper(substr(encode(digest(id::text,'sha256'),'hex'),1,20))) STORED;
ALTER TABLE public.rekon_db_connections ADD COLUMN IF NOT EXISTS public_id text
  GENERATED ALWAYS AS ('FVI-DB-' || upper(substr(encode(digest(id::text,'sha256'),'hex'),1,20))) STORED;
ALTER TABLE public.rekon_inline_api_sources ADD COLUMN IF NOT EXISTS public_id text
  GENERATED ALWAYS AS ('FVI-API-' || upper(substr(encode(digest(id::text,'sha256'),'hex'),1,20))) STORED;
ALTER TABLE public.erp_connector_configs ADD COLUMN IF NOT EXISTS public_id text
  GENERATED ALWAYS AS ('FVI-ERP-' || upper(substr(encode(digest(id::text,'sha256'),'hex'),1,20))) STORED;
ALTER TABLE public.data_watchers ADD COLUMN IF NOT EXISTS public_id text
  GENERATED ALWAYS AS ('FVI-FW-' || upper(substr(encode(digest(id::text,'sha256'),'hex'),1,20))) STORED;
ALTER TABLE public.aidp_templates ADD COLUMN IF NOT EXISTS public_id text
  GENERATED ALWAYS AS ('FVI-AIDPT-' || upper(substr(encode(digest(id::text,'sha256'),'hex'),1,20))) STORED;
ALTER TABLE public.aidp_documents ADD COLUMN IF NOT EXISTS public_id text
  GENERATED ALWAYS AS ('FVI-AIDPD-' || upper(substr(encode(digest(id::text,'sha256'),'hex'),1,20))) STORED;
ALTER TABLE public.reference_data_tables ADD COLUMN IF NOT EXISTS public_id text
  GENERATED ALWAYS AS ('FVI-REF-' || upper(substr(encode(digest(id::text,'sha256'),'hex'),1,20))) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS workspace_data_sources_tenant_public_id_uidx ON public.workspace_data_sources (tenant_id, public_id);
CREATE UNIQUE INDEX IF NOT EXISTS workspace_data_source_uploads_tenant_public_id_uidx ON public.workspace_data_source_uploads (tenant_id, public_id);
CREATE UNIQUE INDEX IF NOT EXISTS data_source_schedules_tenant_public_id_uidx ON public.data_source_schedules (tenant_id, public_id);
CREATE UNIQUE INDEX IF NOT EXISTS rekon_db_connections_tenant_public_id_uidx ON public.rekon_db_connections (tenant_id, public_id);
CREATE UNIQUE INDEX IF NOT EXISTS rekon_inline_api_sources_tenant_public_id_uidx ON public.rekon_inline_api_sources (tenant_id, public_id);
CREATE UNIQUE INDEX IF NOT EXISTS erp_connector_configs_tenant_public_id_uidx ON public.erp_connector_configs (tenant_id, public_id);
CREATE UNIQUE INDEX IF NOT EXISTS data_watchers_tenant_public_id_uidx ON public.data_watchers (tenant_id, public_id);
CREATE UNIQUE INDEX IF NOT EXISTS aidp_templates_tenant_public_id_uidx ON public.aidp_templates (tenant_id, public_id);
CREATE UNIQUE INDEX IF NOT EXISTS aidp_documents_tenant_public_id_uidx ON public.aidp_documents (tenant_id, public_id);
CREATE UNIQUE INDEX IF NOT EXISTS reference_data_tables_tenant_public_id_uidx ON public.reference_data_tables (tenant_id, public_id);
