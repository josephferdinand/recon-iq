-- Idempotency keys for AIDP public API and predict server fn
ALTER TABLE public.aidp_predictions ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE public.aidp_documents   ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS aidp_predictions_tenant_idem_uniq
  ON public.aidp_predictions (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS aidp_documents_tenant_idem_uniq
  ON public.aidp_documents (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;