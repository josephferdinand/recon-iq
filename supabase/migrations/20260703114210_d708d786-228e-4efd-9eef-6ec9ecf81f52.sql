
-- 1. Columns
ALTER TABLE public.platform_invitations
  ADD COLUMN IF NOT EXISTS full_name text;
ALTER TABLE public.tenant_invitations
  ADD COLUMN IF NOT EXISTS full_name text;

-- 2. Update platform consume trigger to also seed profiles.full_name
CREATE OR REPLACE FUNCTION public.consume_platform_invitations_on_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv record;
  seeded_name text;
BEGIN
  IF NEW.email IS NULL THEN
    RETURN NEW;
  END IF;

  FOR inv IN
    SELECT id, role, invited_by, full_name
    FROM public.platform_invitations
    WHERE lower(email::text) = lower(NEW.email)
      AND accepted_at IS NULL
      AND revoked_at IS NULL
      AND expires_at > now()
  LOOP
    BEGIN
      INSERT INTO public.platform_roles (user_id, role, granted_by)
      VALUES (NEW.id, inv.role::platform_role, inv.invited_by);
    EXCEPTION WHEN unique_violation THEN
      NULL;
    END;

    UPDATE public.platform_invitations
       SET accepted_at = now(), accepted_by = NEW.id
     WHERE id = inv.id;

    IF seeded_name IS NULL AND inv.full_name IS NOT NULL AND btrim(inv.full_name) <> '' THEN
      seeded_name := btrim(inv.full_name);
    END IF;

    INSERT INTO public.audit_log (actor_user_id, scope, action, resource_type, resource_id, context)
    VALUES (inv.invited_by, 'platform', 'platform_invitation.accept', 'platform_invitation', inv.id,
            jsonb_build_object('email', NEW.email, 'role', inv.role));
  END LOOP;

  IF seeded_name IS NOT NULL AND (NEW.full_name IS NULL OR btrim(NEW.full_name) = '') THEN
    NEW.full_name := seeded_name;
  END IF;

  RETURN NEW;
END;
$$;

-- Retarget trigger to BEFORE so NEW.full_name assignment persists
DROP TRIGGER IF EXISTS trg_consume_platform_invitations ON public.profiles;
CREATE TRIGGER trg_consume_platform_invitations
BEFORE INSERT OR UPDATE OF email ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.consume_platform_invitations_on_profile();

-- 3. Seed full_name from any pending tenant invitation on first profile row
CREATE OR REPLACE FUNCTION public.seed_profile_name_from_tenant_invites()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  seeded text;
BEGIN
  IF NEW.email IS NULL THEN RETURN NEW; END IF;
  IF NEW.full_name IS NOT NULL AND btrim(NEW.full_name) <> '' THEN RETURN NEW; END IF;

  SELECT btrim(full_name) INTO seeded
  FROM public.tenant_invitations
  WHERE lower(email::text) = lower(NEW.email)
    AND accepted_at IS NULL
    AND expires_at > now()
    AND full_name IS NOT NULL
    AND btrim(full_name) <> ''
  ORDER BY created_at DESC
  LIMIT 1;

  IF seeded IS NOT NULL THEN
    NEW.full_name := seeded;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_profile_name_from_tenant_invites ON public.profiles;
CREATE TRIGGER trg_seed_profile_name_from_tenant_invites
BEFORE INSERT OR UPDATE OF email ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.seed_profile_name_from_tenant_invites();
