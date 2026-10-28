-- Keep newly generated reconciliation run identifiers uppercase at the source.
-- Sixteen UUID hex characters reduce public-ID collision risk versus the prior eight.
-- Existing historical identifiers remain intact; the UI normalizes their display.
CREATE OR REPLACE FUNCTION public.tg_recon_run_uid()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.run_uid IS NULL THEN
    NEW.run_uid := 'R-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(replace(NEW.id::text, '-', ''), 1, 16));
  ELSE
    NEW.run_uid := upper(NEW.run_uid);
  END IF;
  IF NEW.run_uid !~ '^[A-Z0-9]+(-[A-Z0-9]+)*$' THEN
    RAISE EXCEPTION 'Run ID must use uppercase letters, numbers, and hyphen separators'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
