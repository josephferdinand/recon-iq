-- One authoritative audit anchor per UTC day. The generated date makes the
-- idempotency contract enforceable under concurrent cron/manual requests.
alter table public.audit_anchors
  add column if not exists anchor_date date
  generated always as ((anchored_at at time zone 'UTC')::date) stored;

create unique index if not exists audit_anchors_anchor_date_uniq
  on public.audit_anchors (anchor_date);

comment on column public.audit_anchors.anchor_date is
  'Generated UTC date used to enforce one tamper-evidence anchor per day.';
