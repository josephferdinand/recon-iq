-- Extend appointment types with availability, rules, and confirmation settings.
ALTER TABLE public.mkt_appointment_types
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'UTC',
  ADD COLUMN IF NOT EXISTS buffer_before_min int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS buffer_after_min int NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS min_notice_hours int NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS max_advance_days int NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS daily_cap int NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS slot_step_min int NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS requires_approval boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS location text,
  ADD COLUMN IF NOT EXISTS meeting_link_template text,
  ADD COLUMN IF NOT EXISTS availability jsonb NOT NULL DEFAULT
    '{"mon":["09:00-17:00"],"tue":["09:00-17:00"],"wed":["09:00-17:00"],"thu":["09:00-17:00"],"fri":["09:00-17:00"],"sat":[],"sun":[]}'::jsonb,
  ADD COLUMN IF NOT EXISTS confirmation_subject text NOT NULL DEFAULT 'Your Recon Spark session is confirmed',
  ADD COLUMN IF NOT EXISTS confirmation_body text NOT NULL DEFAULT
    'Hi {{first_name}},

Your {{type_name}} with Recon Spark is confirmed for {{when_local}} ({{timezone}}).

We''ll send the calendar invite and joining details separately.

— The Recon Spark team',
  ADD COLUMN IF NOT EXISTS booking_instructions text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Reasonable range checks so bad configs cannot be saved.
DO $$ BEGIN
  ALTER TABLE public.mkt_appointment_types
    ADD CONSTRAINT mkt_appt_types_ranges CHECK (
      duration_min BETWEEN 5 AND 240
      AND buffer_before_min BETWEEN 0 AND 120
      AND buffer_after_min BETWEEN 0 AND 120
      AND min_notice_hours BETWEEN 0 AND 720
      AND max_advance_days BETWEEN 1 AND 365
      AND daily_cap BETWEEN 1 AND 100
      AND slot_step_min BETWEEN 5 AND 120
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Keep updated_at fresh.
CREATE OR REPLACE FUNCTION public.mkt_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_mkt_appt_types_updated_at ON public.mkt_appointment_types;
CREATE TRIGGER trg_mkt_appt_types_updated_at
  BEFORE UPDATE ON public.mkt_appointment_types
  FOR EACH ROW EXECUTE FUNCTION public.mkt_touch_updated_at();

-- Allow public (anon) to create a booking through a narrow SECURITY DEFINER helper.
-- No direct anon INSERT on the table; we only expose the function below.
CREATE OR REPLACE FUNCTION public.mkt_book_appointment(
  _type_slug text,
  _start_at timestamptz,
  _attendee_name text,
  _attendee_email text,
  _notes text DEFAULT NULL,
  _lead_id uuid DEFAULT NULL,
  _source text DEFAULT 'public'
) RETURNS TABLE (id uuid, status text, start_at timestamptz, end_at timestamptz, type_name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_type public.mkt_appointment_types%ROWTYPE;
  v_end timestamptz;
  v_status text;
  v_count int;
  v_email text;
BEGIN
  IF _attendee_email IS NULL OR position('@' in _attendee_email) < 2 THEN
    RAISE EXCEPTION 'invalid_email';
  END IF;
  v_email := lower(trim(_attendee_email));

  SELECT * INTO v_type FROM public.mkt_appointment_types
   WHERE slug = _type_slug AND is_active = true LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_or_inactive_type'; END IF;

  v_end := _start_at + make_interval(mins => v_type.duration_min);

  -- Rules: min notice + max advance
  IF _start_at < now() + make_interval(hours => v_type.min_notice_hours) THEN
    RAISE EXCEPTION 'too_soon';
  END IF;
  IF _start_at > now() + make_interval(days => v_type.max_advance_days) THEN
    RAISE EXCEPTION 'too_far_out';
  END IF;

  -- Daily cap
  SELECT count(*) INTO v_count FROM public.mkt_appointments
    WHERE type_id = v_type.id
      AND status IN ('confirmed','pending')
      AND start_at::date = _start_at::date;
  IF v_count >= v_type.daily_cap THEN RAISE EXCEPTION 'day_full'; END IF;

  -- Overlap guard (any confirmed/pending booking on the same slot)
  IF EXISTS (
    SELECT 1 FROM public.mkt_appointments
     WHERE type_id = v_type.id
       AND status IN ('confirmed','pending')
       AND tstzrange(start_at, end_at, '[)') && tstzrange(_start_at, v_end, '[)')
  ) THEN RAISE EXCEPTION 'slot_taken'; END IF;

  v_status := CASE WHEN v_type.requires_approval THEN 'pending' ELSE 'confirmed' END;

  RETURN QUERY
    INSERT INTO public.mkt_appointments
      (lead_id, type_id, start_at, end_at, status,
       attendee_email, attendee_name, notes, external_provider)
    VALUES
      (_lead_id, v_type.id, _start_at, v_end, v_status,
       v_email, _attendee_name, _notes, _source)
    RETURNING id, status, start_at, end_at, v_type.name;
END; $$;

REVOKE ALL ON FUNCTION public.mkt_book_appointment(text, timestamptz, text, text, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mkt_book_appointment(text, timestamptz, text, text, text, uuid, text) TO anon, authenticated;