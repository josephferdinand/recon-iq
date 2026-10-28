-- Execute after a minimal public.recon_runs(id uuid primary key, run_uid text)
-- table, one pre-migration legacy row, the migration under test, and its
-- BEFORE INSERT trigger are installed in a disposable Postgres instance.
BEGIN;
DO $$
DECLARE
  actual text;
  sample text;
BEGIN
  SELECT run_uid INTO actual FROM public.recon_runs
    WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  IF actual IS DISTINCT FROM 'legacy-123' THEN
    RAISE EXCEPTION 'Historical Run ID was rewritten: %', actual;
  END IF;

  INSERT INTO public.recon_runs(id)
    VALUES ('01234567-89ab-cdef-0123-456789abcdef');
  SELECT run_uid INTO actual FROM public.recon_runs
    WHERE id = '01234567-89ab-cdef-0123-456789abcdef';
  IF actual IS DISTINCT FROM
      'R-' || to_char(now(), 'YYYYMMDD') || '-0123456789ABCDEF' THEN
    RAISE EXCEPTION 'Generated Run ID wrong: %', actual;
  END IF;

  INSERT INTO public.recon_runs(id, run_uid)
    VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'fvi-run-abc123');
  SELECT run_uid INTO actual FROM public.recon_runs
    WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  IF actual IS DISTINCT FROM 'FVI-RUN-ABC123' THEN
    RAISE EXCEPTION 'Supplied Run ID was not normalized: %', actual;
  END IF;

  FOREACH sample IN ARRAY ARRAY[
    'bad_value', 'bad value', 'bad@value', '-BAD', 'BAD-', 'BAD--ID'
  ] LOOP
    BEGIN
      INSERT INTO public.recon_runs(id, run_uid)
        VALUES (gen_random_uuid(), sample);
      RAISE EXCEPTION 'Malformed Run ID was accepted: %', sample;
    EXCEPTION WHEN SQLSTATE '22023' THEN
      NULL;
    END;
  END LOOP;
END $$;
ROLLBACK;
