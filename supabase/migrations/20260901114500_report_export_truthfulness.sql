-- FVI report definitions must advertise only formats the Worker generates.
-- Existing PDF/XLSX labels already produced CSV bytes; normalize their stored
-- metadata so the UI, API contract, filename, MIME type, and payload agree.
BEGIN;

UPDATE public.tenant_report_definitions
SET format = 'csv'
WHERE format IN ('pdf', 'xlsx');

ALTER TABLE public.tenant_report_definitions
  ALTER COLUMN format SET DEFAULT 'csv';

ALTER TABLE public.tenant_report_definitions
  DROP CONSTRAINT IF EXISTS tenant_report_definitions_format_check;

ALTER TABLE public.tenant_report_definitions
  ADD CONSTRAINT tenant_report_definitions_format_check
  CHECK (format IN ('csv', 'json'));

COMMIT;
