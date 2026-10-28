-- Canonicalize the cron execution ledger that previously existed only in
-- PROD as an ad-hoc operational script.
create table if not exists public.cron_run_log (
  id bigserial primary key,
  job text not null,
  ran_at timestamptz not null default now(),
  status text not null default 'ok',
  detail jsonb default '{}'::jsonb,
  duration_ms int
);

create index if not exists idx_cron_run_log_job_ran
  on public.cron_run_log(job, ran_at desc);

alter table public.cron_run_log enable row level security;
revoke all on table public.cron_run_log from anon;
grant insert, select on table public.cron_run_log to service_role;
revoke all on sequence public.cron_run_log_id_seq from anon;
grant usage, select on sequence public.cron_run_log_id_seq to service_role;

drop policy if exists "cron_run_log admin read" on public.cron_run_log;
create policy "cron_run_log admin read"
  on public.cron_run_log for select to authenticated
  using (public.is_platform_admin(auth.uid()));
