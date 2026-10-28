-- Normalize tenant LLM providers for FVI HQ: dedupe, valid model IDs, underscore secret names
DELETE FROM llm_providers
WHERE tenant_id = '355f850e-fee7-4b42-a64e-202779921de4'
  AND id NOT IN (
    SELECT DISTINCT ON (tenant_id, provider) id
    FROM llm_providers
    WHERE tenant_id = '355f850e-fee7-4b42-a64e-202779921de4'
    ORDER BY tenant_id, provider, created_at DESC
  );

UPDATE llm_providers
SET model = 'claude-sonnet-4-5-20250929',
    key_secret_name = 'LLM_TENANT_355f850e_fee7_4b42_a64e_202779921de4_ANTHROPIC'
WHERE tenant_id = '355f850e-fee7-4b42-a64e-202779921de4' AND provider = 'anthropic';

UPDATE llm_providers
SET model = 'gpt-4o',
    key_secret_name = 'LLM_TENANT_355f850e_fee7_4b42_a64e_202779921de4_MUSE'
WHERE tenant_id = '355f850e-fee7-4b42-a64e-202779921de4' AND provider = 'muse';

UPDATE llm_providers
SET model = 'claude-sonnet-4-5-20250929'
WHERE tenant_id IS NULL AND provider = 'anthropic' AND model NOT LIKE '%2024%' AND model NOT LIKE '%2025%';