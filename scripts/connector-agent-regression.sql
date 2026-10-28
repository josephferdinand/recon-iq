\set ON_ERROR_STOP on

begin;

insert into auth.users(id, email, created_at, updated_at)
values ('10000000-0000-4000-8000-000000000001', 'connector-agent-test@example.invalid', now(), now());

insert into public.tenants(id, slug, name)
values ('20000000-0000-4000-8000-000000000001', 'connector-agent-test', 'Connector Agent Test');

insert into public.workspace_data_sources(id, tenant_id, name, source_type, status)
values (
  '30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'SFTP assurance source',
  'csv',
  'ready'
);

insert into public.data_source_schedules(
  id, tenant_id, data_source_id, name, connector_type, config, enabled
) values (
  '40000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  'SFTP assurance schedule',
  'sftp',
  '{"agent_id":"site-a-agent-01","host":"sftp.example.invalid","port":22,"remote_path":"/out","file_pattern":"*.csv","credential_ref":"bank-sftp","host_key_sha256":"SHA256:pinned","password":"must-not-leave-control-plane"}'::jsonb,
  true
);

insert into public.api_tokens(id, tenant_id, name, prefix, token_hash, scopes, created_by)
values
  ('50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'run', 'test', repeat('a', 64), array['connectors.run'], '10000000-0000-4000-8000-000000000001'),
  ('50000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'agent', 'test', repeat('b', 64), array['connectors.agent'], '10000000-0000-4000-8000-000000000001');

select job_id as first_job_id
from public.enqueue_workflow_api_job(
  '20000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'connector_run',
  '40000000-0000-4000-8000-000000000001',
  'agent-success-1'
) \gset
select set_config('fvi.first_job_id', :'first_job_id', false);

do $$
begin
  if (select job_kind <> 'connector_agent_run' from public.workflow_api_jobs where id = current_setting('fvi.first_job_id')::uuid) then
    raise exception 'agent job kind was not selected';
  end if;
  if exists (select 1 from public.claim_workflow_api_job(current_setting('fvi.first_job_id')::uuid)) then
    raise exception 'Cloud worker claimed an agent job';
  end if;
  if exists (
    select 1 from public.claim_connector_agent_job(
      '20000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000002',
      'wrong-agent', 120
    )
  ) then
    raise exception 'wrong agent claimed a job';
  end if;
end $$;

select config as leased_config
from public.claim_connector_agent_job(
  '20000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000002',
  'site-a-agent-01', 120
) \gset
select set_config('fvi.leased_config', :'leased_config', false);

do $$
begin
  if current_setting('fvi.leased_config')::jsonb ? 'password' then
    raise exception 'raw password escaped in lease config';
  end if;
  if current_setting('fvi.leased_config')::jsonb->>'credential_ref' <> 'bank-sftp' then
    raise exception 'credential reference missing';
  end if;
end $$;

select * from public.complete_connector_agent_job(
  '20000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000002',
  'site-a-agent-01',
  :'first_job_id',
  '[{"id":"S1","amount":"125.50"}]'::jsonb,
  '["id","amount"]'::jsonb,
  'agent-test.json', repeat('c', 64), 33
);

do $$
begin
  if (select status <> 'succeeded' from public.workflow_api_jobs where id = current_setting('fvi.first_job_id')::uuid) then
    raise exception 'agent job did not succeed';
  end if;
  if (select count(*) <> 1 from public.workspace_data_source_uploads where tenant_id = '20000000-0000-4000-8000-000000000001') then
    raise exception 'agent upload was not persisted once';
  end if;
  if (select last_rows_ingested <> 1 from public.data_source_schedules where id = '40000000-0000-4000-8000-000000000001') then
    raise exception 'schedule totals were not updated';
  end if;
  if not exists (
    select 1 from public.audit_log
    where tenant_id = '20000000-0000-4000-8000-000000000001'
      and action = 'connector.agent.complete'
      and resource_id = current_setting('fvi.first_job_id')
  ) then
    raise exception 'completion audit missing';
  end if;
end $$;

do $$
begin
  begin
    perform * from public.complete_connector_agent_job(
      '20000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000002',
      'site-a-agent-01', current_setting('fvi.first_job_id')::uuid, '[]'::jsonb, '[]'::jsonb,
      'replay.json', repeat('d', 64), 2
    );
    raise exception 'completion replay was accepted';
  exception when others then
    if sqlerrm = 'completion replay was accepted' then raise; end if;
  end;
end $$;

select job_id as failed_job_id
from public.enqueue_workflow_api_job(
  '20000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'connector_run',
  '40000000-0000-4000-8000-000000000001',
  'agent-failure-1'
) \gset
select set_config('fvi.failed_job_id', :'failed_job_id', false);

select count(*) from public.claim_connector_agent_job(
  '20000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000002',
  'site-a-agent-01', 120
);
select * from public.fail_connector_agent_job(
  '20000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000002',
  'site-a-agent-01', :'failed_job_id', 'connector_agent_upstream_unavailable'
);

do $$
begin
  if (select status <> 'failed' from public.workflow_api_jobs where id = current_setting('fvi.failed_job_id')::uuid) then
    raise exception 'agent failure was not scheduled for retry';
  end if;
  if not exists (
    select 1 from public.audit_log
    where tenant_id = '20000000-0000-4000-8000-000000000001'
      and action = 'connector.agent.retry_scheduled'
      and resource_id = current_setting('fvi.failed_job_id')
  ) then
    raise exception 'retry audit missing';
  end if;
end $$;

rollback;

select 'CONNECTOR_AGENT_REGRESSION_PASS' as result;
