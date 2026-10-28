SELECT current_setting('server_version_num')::int AS engine,
 (SELECT count(*) FROM supabase_migrations.schema_migrations)::int AS ledger,
 (SELECT max(version::text) FROM supabase_migrations.schema_migrations) AS latest,
 (SELECT coalesce(jsonb_agg(jsonb_build_object('pid',pid,'state',state,'elapsed_seconds',extract(epoch from clock_timestamp()-query_start),'wait_type',wait_event_type,'wait_event',wait_event,'blocking_pids',pg_blocking_pids(pid))),'[]'::jsonb)
 FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND state<>'idle' AND query LIKE '%_hilbert_report_current_capture%') AS release_backends;
