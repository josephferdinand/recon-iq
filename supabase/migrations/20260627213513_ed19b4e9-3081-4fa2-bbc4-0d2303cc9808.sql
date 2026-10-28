
-- ========== Projects ==========
CREATE TABLE public.aidp_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  slug text NOT NULL,
  name text NOT NULL,
  description text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.aidp_projects TO authenticated;
GRANT ALL ON public.aidp_projects TO service_role;
ALTER TABLE public.aidp_projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY aidp_projects_read ON public.aidp_projects FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()) OR public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY aidp_projects_write ON public.aidp_projects FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'))
  WITH CHECK (public.is_platform_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'));
CREATE TRIGGER tg_aidp_projects_updated BEFORE UPDATE ON public.aidp_projects
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ========== Document Types ==========
CREATE TABLE public.aidp_document_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.aidp_projects(id) ON DELETE CASCADE,
  code text NOT NULL,
  label text NOT NULL,
  description text,
  default_model_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, code)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.aidp_document_types TO authenticated;
GRANT ALL ON public.aidp_document_types TO service_role;
ALTER TABLE public.aidp_document_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY aidp_doc_types_read ON public.aidp_document_types FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()) OR public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY aidp_doc_types_write ON public.aidp_document_types FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'))
  WITH CHECK (public.is_platform_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'));
CREATE TRIGGER tg_aidp_doc_types_updated BEFORE UPDATE ON public.aidp_document_types
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ========== Entity Types ==========
CREATE TABLE public.aidp_entity_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  document_type_id uuid NOT NULL REFERENCES public.aidp_document_types(id) ON DELETE CASCADE,
  key text NOT NULL,
  label text NOT NULL,
  datatype text NOT NULL DEFAULT 'string',
  extractor text NOT NULL DEFAULT 'text' CHECK (extractor IN ('text','table','classification','number','date','currency')),
  required boolean NOT NULL DEFAULT false,
  confidence_threshold numeric(4,3) NOT NULL DEFAULT 0.800,
  auto_publish_rule_id uuid,
  position int NOT NULL DEFAULT 0,
  options jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_type_id, key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.aidp_entity_types TO authenticated;
GRANT ALL ON public.aidp_entity_types TO service_role;
ALTER TABLE public.aidp_entity_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY aidp_entity_types_read ON public.aidp_entity_types FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()) OR public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY aidp_entity_types_write ON public.aidp_entity_types FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'))
  WITH CHECK (public.is_platform_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'));
CREATE TRIGGER tg_aidp_entity_types_updated BEFORE UPDATE ON public.aidp_entity_types
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ========== Extend existing aidp_documents ==========
ALTER TABLE public.aidp_documents
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.aidp_projects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS document_type_id uuid REFERENCES public.aidp_document_types(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS page_count int,
  ADD COLUMN IF NOT EXISTS rendered_at timestamptz;

-- ========== Pages ==========
CREATE TABLE public.aidp_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.aidp_documents(id) ON DELETE CASCADE,
  page_index int NOT NULL,
  width int NOT NULL,
  height int NOT NULL,
  image_uri text NOT NULL,
  ocr_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, page_index)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.aidp_pages TO authenticated;
GRANT ALL ON public.aidp_pages TO service_role;
ALTER TABLE public.aidp_pages ENABLE ROW LEVEL SECURITY;
CREATE POLICY aidp_pages_read ON public.aidp_pages FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()) OR public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY aidp_pages_write ON public.aidp_pages FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid()) OR public.is_tenant_member(auth.uid(), tenant_id))
  WITH CHECK (public.is_platform_admin(auth.uid()) OR public.is_tenant_member(auth.uid(), tenant_id));

-- ========== Annotations ==========
CREATE TABLE public.aidp_annotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.aidp_documents(id) ON DELETE CASCADE,
  page_id uuid NOT NULL REFERENCES public.aidp_pages(id) ON DELETE CASCADE,
  entity_type_id uuid NOT NULL REFERENCES public.aidp_entity_types(id) ON DELETE CASCADE,
  bbox jsonb NOT NULL,
  value text,
  source text NOT NULL DEFAULT 'human' CHECK (source IN ('human','model')),
  annotated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.aidp_annotations TO authenticated;
GRANT ALL ON public.aidp_annotations TO service_role;
ALTER TABLE public.aidp_annotations ENABLE ROW LEVEL SECURITY;
CREATE POLICY aidp_annotations_read ON public.aidp_annotations FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()) OR public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY aidp_annotations_write ON public.aidp_annotations FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid()) OR public.is_tenant_member(auth.uid(), tenant_id))
  WITH CHECK (public.is_platform_admin(auth.uid()) OR public.is_tenant_member(auth.uid(), tenant_id));
CREATE TRIGGER tg_aidp_annotations_updated BEFORE UPDATE ON public.aidp_annotations
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE INDEX idx_aidp_annotations_doc ON public.aidp_annotations(document_id);
CREATE INDEX idx_aidp_annotations_entity ON public.aidp_annotations(entity_type_id);

-- ========== Models ==========
CREATE TABLE public.aidp_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  document_type_id uuid NOT NULL REFERENCES public.aidp_document_types(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_type_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.aidp_models TO authenticated;
GRANT ALL ON public.aidp_models TO service_role;
ALTER TABLE public.aidp_models ENABLE ROW LEVEL SECURITY;
CREATE POLICY aidp_models_read ON public.aidp_models FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()) OR public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY aidp_models_write ON public.aidp_models FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'))
  WITH CHECK (public.is_platform_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'));
CREATE TRIGGER tg_aidp_models_updated BEFORE UPDATE ON public.aidp_models
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ========== Model Versions ==========
CREATE TABLE public.aidp_model_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  model_id uuid NOT NULL REFERENCES public.aidp_models(id) ON DELETE CASCADE,
  version int NOT NULL,
  status text NOT NULL DEFAULT 'candidate' CHECK (status IN ('training','candidate','active','archived','failed')),
  adapter text NOT NULL DEFAULT 'gateway' CHECK (adapter IN ('gateway','replicate','modal','custom')),
  base_model text NOT NULL DEFAULT 'google/gemini-3-pro-image',
  artifact_uri text,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  training_set_size int NOT NULL DEFAULT 0,
  trained_at timestamptz,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (model_id, version)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.aidp_model_versions TO authenticated;
GRANT ALL ON public.aidp_model_versions TO service_role;
ALTER TABLE public.aidp_model_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY aidp_model_versions_read ON public.aidp_model_versions FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()) OR public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY aidp_model_versions_write ON public.aidp_model_versions FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'))
  WITH CHECK (public.is_platform_admin(auth.uid()) OR public.has_tenant_role(auth.uid(), tenant_id, 'tenant_admin'));
CREATE TRIGGER tg_aidp_model_versions_updated BEFORE UPDATE ON public.aidp_model_versions
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
ALTER TABLE public.aidp_document_types
  ADD CONSTRAINT aidp_doc_types_default_mv_fk
  FOREIGN KEY (default_model_version_id) REFERENCES public.aidp_model_versions(id) ON DELETE SET NULL;

-- ========== Predictions ==========
CREATE TABLE public.aidp_predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.aidp_documents(id) ON DELETE CASCADE,
  model_version_id uuid REFERENCES public.aidp_model_versions(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','succeeded','failed')),
  overall_confidence numeric(4,3),
  latency_ms int,
  raw_response jsonb,
  error text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.aidp_predictions TO authenticated;
GRANT ALL ON public.aidp_predictions TO service_role;
ALTER TABLE public.aidp_predictions ENABLE ROW LEVEL SECURITY;
CREATE POLICY aidp_predictions_read ON public.aidp_predictions FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()) OR public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY aidp_predictions_write ON public.aidp_predictions FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid()) OR public.is_tenant_member(auth.uid(), tenant_id))
  WITH CHECK (public.is_platform_admin(auth.uid()) OR public.is_tenant_member(auth.uid(), tenant_id));
CREATE INDEX idx_aidp_predictions_doc ON public.aidp_predictions(document_id);

-- ========== Prediction Fields ==========
CREATE TABLE public.aidp_prediction_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  prediction_id uuid NOT NULL REFERENCES public.aidp_predictions(id) ON DELETE CASCADE,
  entity_type_id uuid NOT NULL REFERENCES public.aidp_entity_types(id) ON DELETE CASCADE,
  page_id uuid REFERENCES public.aidp_pages(id) ON DELETE SET NULL,
  value text,
  confidence numeric(4,3),
  bbox jsonb,
  accepted_by uuid REFERENCES auth.users(id),
  accepted_at timestamptz,
  rejected_by uuid REFERENCES auth.users(id),
  rejected_at timestamptz,
  review_notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.aidp_prediction_fields TO authenticated;
GRANT ALL ON public.aidp_prediction_fields TO service_role;
ALTER TABLE public.aidp_prediction_fields ENABLE ROW LEVEL SECURITY;
CREATE POLICY aidp_pred_fields_read ON public.aidp_prediction_fields FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()) OR public.is_tenant_member(auth.uid(), tenant_id));
CREATE POLICY aidp_pred_fields_write ON public.aidp_prediction_fields FOR ALL TO authenticated
  USING (public.is_platform_admin(auth.uid()) OR public.is_tenant_member(auth.uid(), tenant_id))
  WITH CHECK (public.is_platform_admin(auth.uid()) OR public.is_tenant_member(auth.uid(), tenant_id));
CREATE INDEX idx_aidp_pred_fields_pred ON public.aidp_prediction_fields(prediction_id);
CREATE INDEX idx_aidp_pred_fields_entity ON public.aidp_prediction_fields(entity_type_id);
