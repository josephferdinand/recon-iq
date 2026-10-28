
CREATE TABLE public.platform_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext NOT NULL,
  role text NOT NULL CHECK (role IN ('platform_admin','platform_member')),
  invited_by uuid REFERENCES auth.users(id),
  message text,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  accepted_at timestamptz,
  accepted_by uuid REFERENCES auth.users(id),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES auth.users(id),
  last_sent_at timestamptz NOT NULL DEFAULT now(),
  send_count int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.platform_invitations (email);
CREATE INDEX ON public.platform_invitations (accepted_at, revoked_at, expires_at);
CREATE UNIQUE INDEX platform_invitations_email_role_pending_uk
  ON public.platform_invitations (lower(email::text), role)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_invitations TO authenticated;
GRANT ALL ON public.platform_invitations TO service_role;
ALTER TABLE public.platform_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "platform admins manage platform invitations"
  ON public.platform_invitations FOR ALL
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

-- Trigger: on new profile, consume any pending platform invitations for that email.
CREATE OR REPLACE FUNCTION public.consume_platform_invitations_on_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv record;
BEGIN
  IF NEW.email IS NULL THEN
    RETURN NEW;
  END IF;

  FOR inv IN
    SELECT id, role
    FROM public.platform_invitations
    WHERE lower(email::text) = lower(NEW.email)
      AND accepted_at IS NULL
      AND revoked_at IS NULL
      AND expires_at > now()
  LOOP
    INSERT INTO public.platform_roles (user_id, role, granted_by)
    VALUES (NEW.id, inv.role::app_platform_role_or_text, inv.invited_by)
    ON CONFLICT DO NOTHING;

    UPDATE public.platform_invitations
       SET accepted_at = now(), accepted_by = NEW.id
     WHERE id = inv.id;

    INSERT INTO public.audit_log (actor_user_id, scope, action, resource_type, resource_id, context)
    VALUES (inv.invited_by, 'platform', 'platform_invitation.accept', 'platform_invitation', inv.id,
            jsonb_build_object('email', NEW.email, 'role', inv.role));
  END LOOP;

  RETURN NEW;
END;
$$;

-- Handle the enum casting robustly regardless of enum name.
DO $$
DECLARE
  role_type text;
BEGIN
  SELECT format_type(atttypid, atttypmod) INTO role_type
    FROM pg_attribute
   WHERE attrelid = 'public.platform_roles'::regclass
     AND attname  = 'role';

  EXECUTE format($f$
    CREATE OR REPLACE FUNCTION public.consume_platform_invitations_on_profile()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $body$
    DECLARE
      inv record;
    BEGIN
      IF NEW.email IS NULL THEN
        RETURN NEW;
      END IF;

      FOR inv IN
        SELECT id, role, invited_by
        FROM public.platform_invitations
        WHERE lower(email::text) = lower(NEW.email)
          AND accepted_at IS NULL
          AND revoked_at IS NULL
          AND expires_at > now()
      LOOP
        BEGIN
          INSERT INTO public.platform_roles (user_id, role, granted_by)
          VALUES (NEW.id, inv.role::%s, inv.invited_by);
        EXCEPTION WHEN unique_violation THEN
          NULL;
        END;

        UPDATE public.platform_invitations
           SET accepted_at = now(), accepted_by = NEW.id
         WHERE id = inv.id;

        INSERT INTO public.audit_log (actor_user_id, scope, action, resource_type, resource_id, context)
        VALUES (inv.invited_by, 'platform', 'platform_invitation.accept', 'platform_invitation', inv.id,
                jsonb_build_object('email', NEW.email, 'role', inv.role));
      END LOOP;

      RETURN NEW;
    END;
    $body$;
  $f$, role_type);
END $$;

DROP TRIGGER IF EXISTS trg_consume_platform_invitations ON public.profiles;
CREATE TRIGGER trg_consume_platform_invitations
AFTER INSERT OR UPDATE OF email ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.consume_platform_invitations_on_profile();
