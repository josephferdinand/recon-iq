DO $$
DECLARE
  generated_code text;
BEGIN
  IF (SELECT recon_code FROM public.recon_definitions WHERE id='e2000000-0000-4000-8000-000000000011') <> 'FVI-TREAS-1WAY-000001' THEN
    RAISE EXCEPTION 'first legacy one-sided identifier is incorrect';
  END IF;
  IF (SELECT recon_code FROM public.recon_definitions WHERE id='e2000000-0000-4000-8000-000000000012') <> 'FVI-TREAS-1WAY-000002' THEN
    RAISE EXCEPTION 'second legacy one-sided identifier is incorrect';
  END IF;
  IF (SELECT recon_code FROM public.recon_definitions WHERE id='e2000000-0000-4000-8000-000000000013') <> 'FVI-TREAS-2WAY-000001' THEN
    RAISE EXCEPTION 'two-sided identifier partition is incorrect';
  END IF;

  INSERT INTO public.recon_definitions (tenant_id, bu_id, name, recon_type, sides, rules)
  VALUES (
    'e2000000-0000-4000-8000-000000000002',
    'e2000000-0000-4000-8000-000000000004',
    'New Intraday Liquidity',
    'one_sided',
    '[]',
    '[]'
  )
  RETURNING recon_code INTO generated_code;
  IF generated_code <> 'FVI-TREAS-1WAY-000003' THEN
    RAISE EXCEPTION 'next generated identifier is incorrect: %', generated_code;
  END IF;

  BEGIN
    UPDATE public.recon_definitions
    SET recon_code='FVI-TREAS-1WAY-999999'
    WHERE id='e2000000-0000-4000-8000-000000000011';
    RAISE EXCEPTION 'identifier mutation unexpectedly accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='identifier mutation unexpectedly accepted' THEN RAISE; END IF;
  END;

  BEGIN
    INSERT INTO public.recon_definitions (tenant_id, name, recon_type, sides, rules, recon_code)
    VALUES ('e2000000-0000-4000-8000-000000000002', 'Invalid Identifier', 'one_sided', '[]', '[]', 'INVALID');
    RAISE EXCEPTION 'invalid identifier unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  IF (SELECT count(*) FROM public.audit_log
      WHERE tenant_id='e2000000-0000-4000-8000-000000000002'
        AND action='recon.identifier.backfilled') <> 3 THEN
    RAISE EXCEPTION 'backfill audit count is incorrect';
  END IF;
END;
$$;

SELECT 'reconciliation_identifier_PASS immutable=yes deterministic=yes next=000003 audit=3' AS result;
