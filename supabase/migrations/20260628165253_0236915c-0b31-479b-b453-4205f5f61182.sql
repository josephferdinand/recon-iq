
-- D2: EMIR Refit preconfigured processes — extend regulatory pack schema

ALTER TABLE public.regulatory_template_packs
  ADD COLUMN IF NOT EXISTS pack_code text,
  ADD COLUMN IF NOT EXISTS field_dictionary jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS default_process_template jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS required_data_inputs jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS install_runbook_url text;

-- Backfill pack_code from code where missing
UPDATE public.regulatory_template_packs
  SET pack_code = code
  WHERE pack_code IS NULL;

-- Unique index on pack_code
CREATE UNIQUE INDEX IF NOT EXISTS regulatory_template_packs_pack_code_uidx
  ON public.regulatory_template_packs (pack_code)
  WHERE pack_code IS NOT NULL;

ALTER TABLE public.regulatory_pack_installs
  ADD COLUMN IF NOT EXISTS generated_process_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tenant_root_process_id uuid REFERENCES public.recon_definitions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

-- Widen install status check to include D2 lifecycle
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint
    WHERE conrelid = 'public.regulatory_pack_installs'::regclass
      AND contype='c' AND pg_get_constraintdef(oid) ILIKE '%status%';
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.regulatory_pack_installs DROP CONSTRAINT %I', c);
  END IF;
END$$;

ALTER TABLE public.regulatory_pack_installs
  ADD CONSTRAINT regulatory_pack_installs_status_check
  CHECK (status IN ('pending','installing','materializing','ready','failed','superseded'));

-- Seed EMIR Refit v3 pack
INSERT INTO public.regulatory_template_packs
  (code, pack_code, title, jurisdiction, regulation, version, summary,
   field_dictionary, default_process_template, required_data_inputs,
   install_runbook_url, status, definition, tags)
VALUES (
  'EMIR_REFIT_V3',
  'EMIR_REFIT_V3',
  'EMIR Refit v3 (EU securities reconciliation)',
  'EU',
  'EMIR',
  '3.0',
  'EU securities reconciliation per Regulation 648/2012 + RTS 22/2017. Ships folder, 2 data-prep pipelines, and a wired trade-match recon.',
  '{
    "trade": {
      "uti": {"type":"string","required":true,"description":"Unique Trade Identifier per ISO 23897. 52 alphanumeric chars."},
      "prior_uti": {"type":"string","required":false,"description":"Previous UTI for lifecycle events."},
      "venue": {"type":"enum","values":["XOFF","XTSE","XOFF+","SINT"],"required":true},
      "execution_timestamp": {"type":"datetime","required":true,"format":"ISO8601"},
      "value_date": {"type":"date","required":true},
      "trade_type": {"type":"enum","values":["SEF","OTF","FX","SECLEND","REPO"],"required":true},
      "action_type": {"type":"enum","values":["NEWT","MODI","EARX","CANC","TERM"],"required":true},
      "notional": {"type":"decimal","required":true,"currency":true},
      "notional_currency": {"type":"string","required":true,"format":"ISO4217"},
      "lei_cpty": {"type":"string","required":true,"format":"20-char LEI"},
      "lei_reporting": {"type":"string","required":true,"format":"20-char LEI"},
      "cleared": {"type":"boolean","required":true},
      "clearing_house": {"type":"string","required_if":"cleared=true","format":"20-char LEI"},
      "collateral_portfolio": {"type":"boolean","required":true},
      "collateral_value": {"type":"decimal","required_if":"collateral_portfolio=true"}
    },
    "match": {
      "primary_key":"uti",
      "secondary_keys":["execution_timestamp","lei_cpty"],
      "tolerance": {"notional":{"abs":"0.01","pct":"0.0001"},"value_date":{"days":0}}
    },
    "validation": {"esma_rts_22":true,"pair_off":true,"compression_eligible":false}
  }'::jsonb,
  '{
    "folder": {"name":"EMIR Refit v3","description":"EU securities reconciliation per Regulation 648/2012 + RTS 22/2017"},
    "data_prep_pipelines": [
      {"name":"EMIR — Internal trades","purpose":"Internal","input_schema":"trade",
       "transformation_steps":["validate_uti_format","validate_lei_format","enrich_with_internal_uti_alias","normalize_datetime_to_utc"]},
      {"name":"EMIR — Counterparty trades (TR)","purpose":"External","input_schema":"trade",
       "transformation_steps":["validate_uti_format","validate_lei_format","validate_esma_action_type"]}
    ],
    "recon_processes": [
      {"name":"EMIR — Trade match (Internal vs TR)","match_key":"uti",
       "match_keys_secondary":["execution_timestamp","lei_cpty"],
       "tolerance":{"notional_abs":"0.01","notional_pct":"0.0001","value_date_days":0},
       "exception_workflow":true,"sla_policy":"EMIR_24H_BREACH"}
    ]
  }'::jsonb,
  '[
    {"id":"internal_trades","name":"Internal trade capture","format":"csv|xlsx|api|sftp","schema_ref":"trade","frequency":"T+1","source":"customer_provided"},
    {"id":"trade_repository","name":"Counterparty trade reports (Arm/DTCC/UnaVista/etc.)","format":"api|sftp","schema_ref":"trade","frequency":"T+1","source":"customer_provided"}
  ]'::jsonb,
  'https://docs.recon-spark.example/regulatory/emir-refit',
  'published',
  '{"source":"D2_seed"}'::jsonb,
  ARRAY['EMIR','EU','Refit','ESMA','Trade Repository']
)
ON CONFLICT (code) DO UPDATE SET
  pack_code = EXCLUDED.pack_code,
  field_dictionary = EXCLUDED.field_dictionary,
  default_process_template = EXCLUDED.default_process_template,
  required_data_inputs = EXCLUDED.required_data_inputs,
  install_runbook_url = EXCLUDED.install_runbook_url,
  updated_at = now();
