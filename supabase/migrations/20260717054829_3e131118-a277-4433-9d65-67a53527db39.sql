
UPDATE public.llm_providers
SET base_url = NULL
WHERE base_url ILIKE '%meta.dev%' OR base_url ILIKE '%ai.gateway.meta%';

DO $$
BEGIN
  INSERT INTO public.audit_log (action, resource_type, resource_id, metadata)
  VALUES (
    'meta.removal',
    'platform',
    NULL,
    jsonb_build_object(
      'summary','Removed Meta AI Gateway runtime path and Meta-branded metadata',
      'phase','enterprise_removal_v1'
    )
  );
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
