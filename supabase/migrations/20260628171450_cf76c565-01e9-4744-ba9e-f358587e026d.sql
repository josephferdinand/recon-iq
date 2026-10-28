
-- 1) Safe seed: never overwrite existing EMIR_REFIT_V3 row.
INSERT INTO public.regulatory_template_packs (code, pack_code, title, regulation, jurisdiction, version, status, summary, tags)
SELECT 'EMIR_REFIT_V3', 'EMIR_REFIT_V3', 'EMIR Refit v3', 'EMIR', 'EU', '3.0', 'published',
       'EU EMIR Refit v3 trade reporting reconciliation pack — TR vs internal trade match with ESMA field dictionary.',
       ARRAY['regulatory','esma','emir']
WHERE NOT EXISTS (
  SELECT 1 FROM public.regulatory_template_packs WHERE code = 'EMIR_REFIT_V3' OR pack_code = 'EMIR_REFIT_V3'
);

-- 2) Atomic claim — only one worker can flip a row out of installing/pending.
CREATE OR REPLACE FUNCTION public.claim_regulatory_install(_install_id uuid)
RETURNS TABLE(claimed boolean, install_row jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r jsonb;
BEGIN
  UPDATE public.regulatory_pack_installs
     SET status = 'materializing'
   WHERE id = _install_id
     AND status IN ('installing','pending','materializing')
  RETURNING to_jsonb(regulatory_pack_installs.*) INTO r;

  RETURN QUERY SELECT (r IS NOT NULL), r;
END
$$;

REVOKE ALL ON FUNCTION public.claim_regulatory_install(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_regulatory_install(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_regulatory_install(uuid) TO service_role;

-- 3) Atomic completion — flips row to ready with materialized artefacts.
CREATE OR REPLACE FUNCTION public.complete_regulatory_install(
  _install_id uuid,
  _recon_id uuid,
  _pipeline_ids uuid[],
  _folder_name text,
  _field_count int
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.regulatory_pack_installs
     SET status = 'ready',
         completed_at = now(),
         materialized_at = now(),
         generated_process_count = COALESCE(array_length(_pipeline_ids, 1), 0) + 1,
         tenant_root_process_id = _recon_id,
         recon_id = _recon_id,
         materialized_artifacts = jsonb_build_object(
           'folder', _folder_name,
           'pipeline_ids', to_jsonb(_pipeline_ids),
           'recon_id', _recon_id,
           'field_count', _field_count
         )
   WHERE id = _install_id;
END
$$;

REVOKE ALL ON FUNCTION public.complete_regulatory_install(uuid, uuid, uuid[], text, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_regulatory_install(uuid, uuid, uuid[], text, int) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_regulatory_install(uuid, uuid, uuid[], text, int) TO service_role;
