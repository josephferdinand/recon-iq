-- Current Anthropic list pricing for the owner-approved proxy model IDs.
-- Claude Sonnet 5: USD 2 / 1M input, USD 10 / 1M output.
-- Claude Opus 5:   USD 5 / 1M input, USD 25 / 1M output.
-- The custom Muse-compatible rows mirror the same upstream rates because
-- FVI's primary route uses that provider code for the secured proxy.

INSERT INTO public.ai_model_pricing (
  provider_code,
  model_key,
  input_usd_per_1m,
  output_usd_per_1m,
  currency,
  effective_at,
  active
)
VALUES
  ('anthropic', 'claude-sonnet-5', 2.000000, 10.000000, 'USD', '2026-08-10T00:00:00Z', true),
  ('anthropic', 'claude-opus-5', 5.000000, 25.000000, 'USD', '2026-03-01T00:00:00Z', true),
  ('custom_muse_compatible', 'claude-sonnet-5', 2.000000, 10.000000, 'USD', '2026-08-10T00:00:00Z', true),
  ('custom_muse_compatible', 'claude-opus-5', 5.000000, 25.000000, 'USD', '2026-03-01T00:00:00Z', true)
ON CONFLICT (provider_code, model_key, effective_at)
DO UPDATE SET
  input_usd_per_1m = EXCLUDED.input_usd_per_1m,
  output_usd_per_1m = EXCLUDED.output_usd_per_1m,
  currency = EXCLUDED.currency,
  active = true,
  updated_at = now();
