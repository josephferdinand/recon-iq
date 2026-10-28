
WITH candidates AS (
  SELECT s.id, s.scope, s.tenant_id, s.name AS old_name,
         CASE
           WHEN s.scope = 'platform' AND s.name ~ '^LLM_PLATFORM_[A-Z0-9]+_KEY$'
             THEN regexp_replace(s.name, '^LLM_PLATFORM_([A-Z0-9]+)_KEY$', '\1')
           WHEN s.scope = 'tenant'   AND s.name ~ '^LLM_TENANT_[0-9a-fA-F_-]+_[A-Z0-9]+$'
             THEN regexp_replace(s.name, '^LLM_TENANT_[0-9a-fA-F_-]+_([A-Z0-9]+)$', '\1')
           ELSE NULL
         END AS new_name
    FROM public.app_vault_secrets s
   WHERE s.secret_class = 'llm_api_key'
), renames AS (
  SELECT c.* FROM candidates c
   WHERE c.new_name IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.app_vault_secrets t
        WHERE t.secret_class = 'llm_api_key' AND t.scope = c.scope
          AND t.name = c.new_name
          AND (t.tenant_id IS NOT DISTINCT FROM c.tenant_id)
     )
)
UPDATE public.app_vault_secrets s
   SET name = r.new_name
  FROM renames r
 WHERE s.id = r.id;

UPDATE public.llm_providers
   SET key_secret_name = upper(provider::text)
 WHERE key_secret_name IS DISTINCT FROM upper(provider::text);
