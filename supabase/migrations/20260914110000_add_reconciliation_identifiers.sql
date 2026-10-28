-- Immutable, tenant-scoped business identifiers for reconciliation definitions.

ALTER TABLE public.recon_definitions
  ADD COLUMN IF NOT EXISTS recon_code text;

WITH normalized AS (
  SELECT
    rd.id,
    rd.tenant_id,
    CASE
      WHEN length(upper(regexp_replace(coalesce(nullif(bu.code, ''), 'GEN'), '[^A-Za-z0-9]', '', 'g'))) >= 2
        THEN left(upper(regexp_replace(coalesce(nullif(bu.code, ''), 'GEN'), '[^A-Za-z0-9]', '', 'g')), 12)
      ELSE 'GEN'
    END AS department_code,
    CASE rd.recon_type
      WHEN 'one_sided' THEN '1WAY'
      WHEN 'two_sided' THEN '2WAY'
      WHEN 'three_sided' THEN '3WAY'
      ELSE '1WAY'
    END AS process_code,
    row_number() OVER (
      PARTITION BY rd.tenant_id,
        CASE
          WHEN length(upper(regexp_replace(coalesce(nullif(bu.code, ''), 'GEN'), '[^A-Za-z0-9]', '', 'g'))) >= 2
            THEN left(upper(regexp_replace(coalesce(nullif(bu.code, ''), 'GEN'), '[^A-Za-z0-9]', '', 'g')), 12)
          ELSE 'GEN'
        END,
        rd.recon_type
      ORDER BY rd.created_at, rd.id
    ) AS sequence_value
  FROM public.recon_definitions rd
  LEFT JOIN public.business_units bu
    ON bu.id = rd.bu_id AND bu.tenant_id = rd.tenant_id
  WHERE rd.recon_code IS NULL
)
UPDATE public.recon_definitions rd
SET recon_code = format(
  'FVI-%s-%s-%s',
  normalized.department_code,
  normalized.process_code,
  lpad(normalized.sequence_value::text, 6, '0')
)
FROM normalized
WHERE rd.id = normalized.id;

ALTER TABLE public.recon_definitions
  ALTER COLUMN recon_code SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS recon_definitions_tenant_recon_code_uidx
  ON public.recon_definitions (tenant_id, recon_code);

ALTER TABLE public.recon_definitions
  DROP CONSTRAINT IF EXISTS recon_definitions_recon_code_check,
  ADD CONSTRAINT recon_definitions_recon_code_check
    CHECK (recon_code ~ '^FVI-[A-Z0-9]{2,12}-(1WAY|2WAY|3WAY)-[0-9]{6,}$');

CREATE OR REPLACE FUNCTION public.assign_reconciliation_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  department_code text;
  process_code text;
  sequence_value bigint;
BEGIN
  IF NEW.recon_code IS NOT NULL THEN
    IF coalesce(auth.role(), current_user) NOT IN ('service_role', 'postgres') THEN
      RAISE EXCEPTION 'reconciliation identifier is system managed';
    END IF;
    RETURN NEW;
  END IF;

  SELECT CASE
    WHEN length(upper(regexp_replace(coalesce(nullif(bu.code, ''), 'GEN'), '[^A-Za-z0-9]', '', 'g'))) >= 2
      THEN left(upper(regexp_replace(coalesce(nullif(bu.code, ''), 'GEN'), '[^A-Za-z0-9]', '', 'g')), 12)
    ELSE 'GEN'
  END
  INTO department_code
  FROM (SELECT NEW.bu_id AS id) requested
  LEFT JOIN public.business_units bu
    ON bu.id = requested.id AND bu.tenant_id = NEW.tenant_id;

  department_code := coalesce(department_code, 'GEN');
  process_code := CASE NEW.recon_type
    WHEN 'one_sided' THEN '1WAY'
    WHEN 'two_sided' THEN '2WAY'
    WHEN 'three_sided' THEN '3WAY'
    ELSE '1WAY'
  END;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(NEW.tenant_id::text || ':' || department_code || ':' || process_code, 0)
  );

  SELECT coalesce(max(split_part(recon_code, '-', 4)::bigint), 0) + 1
  INTO sequence_value
  FROM public.recon_definitions
  WHERE tenant_id = NEW.tenant_id
    AND recon_code LIKE 'FVI-' || department_code || '-' || process_code || '-%';

  NEW.recon_code := format(
    'FVI-%s-%s-%s', department_code, process_code, lpad(sequence_value::text, 6, '0')
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_reconciliation_identity_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.recon_code IS DISTINCT FROM OLD.recon_code THEN
    RAISE EXCEPTION 'reconciliation identifier is immutable';
  END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'reconciliation tenant is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_reconciliation_code ON public.recon_definitions;
CREATE TRIGGER trg_assign_reconciliation_code
  BEFORE INSERT ON public.recon_definitions
  FOR EACH ROW EXECUTE FUNCTION public.assign_reconciliation_code();

DROP TRIGGER IF EXISTS trg_prevent_reconciliation_identity_change ON public.recon_definitions;
CREATE TRIGGER trg_prevent_reconciliation_identity_change
  BEFORE UPDATE OF recon_code, tenant_id ON public.recon_definitions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_reconciliation_identity_change();

REVOKE ALL ON FUNCTION public.assign_reconciliation_code() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_reconciliation_identity_change() FROM PUBLIC;

INSERT INTO public.audit_log (
  actor_user_id, tenant_id, scope, action, resource_type, resource_id, context
)
SELECT NULL, rd.tenant_id, 'system', 'recon.identifier.backfilled',
       'recon_definition', rd.id::text,
       jsonb_build_object('recon_code', rd.recon_code)
FROM public.recon_definitions rd
WHERE NOT EXISTS (
  SELECT 1 FROM public.audit_log audit
  WHERE audit.action = 'recon.identifier.backfilled'
    AND audit.resource_type = 'recon_definition'
    AND audit.resource_id = rd.id::text
);
