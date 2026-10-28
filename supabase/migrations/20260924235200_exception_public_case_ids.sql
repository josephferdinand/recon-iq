-- Give every exception a safe public identifier without altering existing
-- row visibility or workflow authorization. BU-scoped RLS is a separate cutover.
-- Apply only after checking exception row volume and a production lock window.

ALTER TABLE public.recon_exceptions
  ADD COLUMN IF NOT EXISTS public_case_id text;

UPDATE public.recon_exceptions
SET public_case_id = 'FVI-EXC-' || upper(replace(gen_random_uuid()::text, '-', ''))
WHERE public_case_id IS NULL;

INSERT INTO public.audit_log (
  actor_user_id, tenant_id, scope, action, resource_type, resource_id, context
)
SELECT NULL, exception_row.tenant_id, 'system', 'exception.public_case_id.backfilled',
       'recon_exception', exception_row.id::text,
       jsonb_build_object('public_case_id', exception_row.public_case_id)
FROM public.recon_exceptions exception_row
WHERE NOT EXISTS (
  SELECT 1 FROM public.audit_log audit
  WHERE audit.action = 'exception.public_case_id.backfilled'
    AND audit.resource_type = 'recon_exception'
    AND audit.resource_id = exception_row.id::text
);

ALTER TABLE public.recon_exceptions
  ALTER COLUMN public_case_id SET NOT NULL;

ALTER TABLE public.recon_exceptions
  DROP CONSTRAINT IF EXISTS recon_exceptions_public_case_id_check,
  ADD CONSTRAINT recon_exceptions_public_case_id_check
    CHECK (public_case_id ~ '^FVI-EXC-[A-F0-9]{32}$');

CREATE UNIQUE INDEX IF NOT EXISTS recon_exceptions_tenant_public_case_id_uidx
  ON public.recon_exceptions (tenant_id, public_case_id);

CREATE OR REPLACE FUNCTION public.assign_exception_public_case_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.public_case_id IS NOT NULL THEN
      RAISE EXCEPTION 'exception case identifier is system managed';
    END IF;
    NEW.public_case_id := 'FVI-EXC-' || upper(replace(gen_random_uuid()::text, '-', ''));
    RETURN NEW;
  END IF;

  IF NEW.public_case_id IS DISTINCT FROM OLD.public_case_id THEN
    RAISE EXCEPTION 'exception case identifier is immutable';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.assign_exception_public_case_id() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_assign_exception_public_case_id ON public.recon_exceptions;
CREATE TRIGGER trg_assign_exception_public_case_id
  BEFORE INSERT OR UPDATE OF public_case_id ON public.recon_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.assign_exception_public_case_id();

COMMENT ON COLUMN public.recon_exceptions.public_case_id IS
  'Immutable opaque FVI exception identifier; generated independently from the internal UUID.';
