-- Route authenticated browser create/update through the same atomic,
-- actor-bound and audited implementation used by the public API.

CREATE OR REPLACE FUNCTION public.upsert_data_prep_pipeline(
  _tenant_id uuid,
  _pipeline_id uuid,
  _payload jsonb
)
RETURNS TABLE(pipeline_id uuid,public_uid text,pipeline_status text,pipeline_version integer)
LANGUAGE sql
SECURITY DEFINER
SET search_path=public
AS $$
  SELECT * FROM public.upsert_data_prep_pipeline_for_api(
    _tenant_id,_pipeline_id,_payload,auth.uid()
  )
$$;

REVOKE ALL ON FUNCTION public.upsert_data_prep_pipeline(uuid,uuid,jsonb)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.upsert_data_prep_pipeline(uuid,uuid,jsonb)
  TO authenticated;
