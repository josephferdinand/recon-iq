
UPDATE public.llm_providers
  SET key_secret_name='LLM_TENANT_355f850e_fee7_4b42_a64e_202779921de4_ANTHROPIC', updated_at=now()
  WHERE tenant_id='355f850e-fee7-4b42-a64e-202779921de4' AND provider='anthropic';
UPDATE public.llm_providers
  SET key_secret_name='LLM_TENANT_355f850e_fee7_4b42_a64e_202779921de4_MUSE', updated_at=now()
  WHERE tenant_id='355f850e-fee7-4b42-a64e-202779921de4' AND provider='muse';
