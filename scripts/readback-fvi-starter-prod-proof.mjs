import { readFile } from "node:fs/promises";
import path from "node:path";

const PROD_REF = "YOUR_PROJECT_REF";
const TENANT_ID = "aa5ed999-69eb-41a0-a9c6-fbb439efcffb";
const TENANT_SLUG = "reconiq-assurance-lab-prod";
const DEFINITION_NAME = "Assurance Starter Vostro — 2026-09-15 QA";
const DISPLAYED_RECON_CODE = "FVI-GEN-2WAY-000009";

const vaultPath = process.env.FVI_VAULT_PATH ?? "";
if (!path.isAbsolute(vaultPath) || path.basename(vaultPath) !== "Falcon-Veritas-Keys.md") {
  throw new Error("FVI_VAULT_PATH must be the absolute canonical Falcon-Veritas-Keys.md path");
}

function unwrapKnownMarkdown(value) {
  let normalized = value.trim();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (normalized.startsWith("`") && normalized.endsWith("`")) {
      normalized = normalized.slice(1, -1).trim();
      continue;
    }
    if (normalized.startsWith("<") && normalized.endsWith(">")) {
      normalized = normalized.slice(1, -1).trim();
      continue;
    }
    break;
  }
  return normalized;
}

const vault = await readFile(vaultPath, "utf8");
const beginMarker = "<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->";
const endMarker = "<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->";
const begin = vault.indexOf(beginMarker);
const end = vault.indexOf(endMarker);
if (begin < 0 || end <= begin) throw new Error("Canonical FVI credential section is unavailable");

const tokenRow = vault
  .slice(begin + beginMarker.length, end)
  .split(/\r?\n/u)
  .find((line) => /^\|\s*`SUPABASE_ACCESS_TOKEN`\s*\|/u.test(line));
const accessToken = unwrapKnownMarkdown(tokenRow?.split("|")[2] ?? "");
if (!accessToken) throw new Error("FVI Supabase Management credential is unavailable");

const sql = `WITH target_tenant AS MATERIALIZED (
  SELECT tenant.id, tenant.slug, tenant.environment::text AS environment
  FROM public.tenants tenant
  WHERE tenant.id = '${TENANT_ID}'::uuid
    AND tenant.slug = '${TENANT_SLUG}'
    AND tenant.environment = 'prod'
), target_definitions AS MATERIALIZED (
  SELECT definition.*
  FROM public.recon_definitions definition
  JOIN target_tenant tenant ON tenant.id = definition.tenant_id
  WHERE definition.name = '${DEFINITION_NAME}'
  ORDER BY definition.created_at, definition.id
  LIMIT 10
)
SELECT jsonb_build_object(
  'tenant', jsonb_build_object(
    'id', tenant.id,
    'slug', tenant.slug,
    'environment', tenant.environment
  ),
  'definition_match_count', (
    SELECT count(*)::integer
    FROM public.recon_definitions definition
    WHERE definition.tenant_id = tenant.id
      AND definition.name = '${DEFINITION_NAME}'
  ),
  'definitions', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', definition.id,
      'recon_code', definition.recon_code,
      'status', definition.status,
      'recon_type', definition.recon_type,
      'creator_id', definition.created_by,
      'interactive_quota_hits_this_hour', COALESCE((
        SELECT bucket.count FROM public.rate_limit_buckets bucket
        WHERE bucket.bucket_key = 'recon.run:' || tenant.id::text || ':' || definition.created_by::text
          AND bucket.window_start = to_timestamp(floor(extract(epoch FROM now()) / 3600) * 3600)
      ), 0),
      'starter_template_id', definition.starter_template_id,
      'starter_template_code', definition.starter_template_code,
      'side_mappings', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'side_id', side.value->>'side_id',
          'source_id', side.value->>'data_source_id',
          'field_names', COALESCE((
            SELECT jsonb_agg(fields.field_name ORDER BY fields.field_name)
            FROM (
              SELECT DISTINCT mapped.value AS field_name
              FROM jsonb_array_elements(definition.rules) rule(value)
              CROSS JOIN LATERAL jsonb_each_text(
                CASE
                  WHEN jsonb_typeof(rule.value->'fields') = 'object' THEN rule.value->'fields'
                  ELSE '{}'::jsonb
                END
              ) mapped(side_id, value)
              WHERE mapped.side_id = side.value->>'side_id'
                AND NULLIF(mapped.value, '') IS NOT NULL
            ) fields
          ), '[]'::jsonb)
        ) ORDER BY side.ordinality)
        FROM jsonb_array_elements(definition.sides) WITH ORDINALITY side(value, ordinality)
      ), '[]'::jsonb),
      'rule_count', jsonb_array_length(definition.rules),
      'rule_kinds', COALESCE((
        SELECT jsonb_agg(rule.value->>'kind' ORDER BY rule.ordinality)
        FROM jsonb_array_elements(definition.rules) WITH ORDINALITY rule(value, ordinality)
      ), '[]'::jsonb),
      'catalogue_install_count', (
        SELECT template.install_count
        FROM public.recon_definition_templates template
        WHERE template.id = definition.starter_template_id
          AND template.code = definition.starter_template_code
      ),
      'installation_audit_events', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', audit.id,
          'action', audit.action,
          'actor_id', audit.actor_user_id,
          'resource_type', audit.resource_type,
          'resource_id', audit.resource_id,
          'occurred_at', audit.occurred_at,
          'safe_context_counts', jsonb_strip_nulls(jsonb_build_object(
            'rule_count', CASE
              WHEN jsonb_typeof(audit.context->'rule_count') = 'number'
                THEN (audit.context->>'rule_count')::integer
              ELSE NULL
            END
          ))
        ) ORDER BY audit.occurred_at, audit.id)
        FROM (
          SELECT event.id::text AS id, event.action, event.actor_user_id,
                 event.resource_type, event.resource_id, event.occurred_at, event.context
          FROM public.audit_log event
          WHERE event.tenant_id = tenant.id
            AND event.action = 'recon.template.install'
            AND event.resource_type = 'recon_definition'
            AND event.resource_id = definition.id::text
          ORDER BY event.occurred_at, event.id
          LIMIT 10
        ) audit
      ), '[]'::jsonb),
      'runs', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', run.id,
          'status', run.status,
          'matched_count', run.matched_count,
          'exception_count', run.exception_count,
          'total_rows', run.total_rows,
          'started_at', run.started_at,
          'completed_at', run.completed_at,
          'match_row_count', (
            SELECT count(*)::integer
            FROM public.recon_matches match
            WHERE match.tenant_id = tenant.id AND match.run_id = run.id
          ),
          'exception_row_count', (
            SELECT count(*)::integer
            FROM public.recon_exceptions exception
            WHERE exception.tenant_id = tenant.id AND exception.run_id = run.id
          ),
          'run_audit_events', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'id', audit.id,
              'action', audit.action,
              'actor_id', audit.actor_user_id,
              'resource_type', audit.resource_type,
              'resource_id', audit.resource_id,
              'occurred_at', audit.occurred_at,
              'safe_context_counts', jsonb_strip_nulls(jsonb_build_object(
                'matched', CASE
                  WHEN jsonb_typeof(audit.context->'matched') = 'number'
                    THEN (audit.context->>'matched')::integer
                  ELSE NULL
                END,
                'exceptions', CASE
                  WHEN jsonb_typeof(audit.context->'exceptions') = 'number'
                    THEN (audit.context->>'exceptions')::integer
                  ELSE NULL
                END,
                'total_rows', CASE
                  WHEN jsonb_typeof(audit.context->'total_rows') = 'number'
                    THEN (audit.context->>'total_rows')::integer
                  ELSE NULL
                END
              ))
            ) ORDER BY audit.occurred_at, audit.id)
            FROM (
              SELECT event.id::text AS id, event.action, event.actor_user_id,
                     event.resource_type, event.resource_id, event.occurred_at, event.context
              FROM public.audit_log event
              WHERE event.tenant_id = tenant.id
                AND event.action IN ('recon.run.complete', 'recon.api.run.complete')
                AND event.resource_type = 'recon_run'
                AND event.resource_id = run.id::text
              ORDER BY event.occurred_at, event.id
              LIMIT 10
            ) audit
          ), '[]'::jsonb)
        ) ORDER BY run.started_at DESC, run.id)
        FROM (
          SELECT candidate.id, candidate.status, candidate.matched_count,
                 candidate.exception_count, candidate.total_rows,
                 candidate.started_at, candidate.completed_at
          FROM public.recon_runs candidate
          WHERE candidate.tenant_id = tenant.id
            AND candidate.definition_id = definition.id
          ORDER BY candidate.started_at DESC, candidate.id
          LIMIT 20
        ) run
      ), '[]'::jsonb)
    ) ORDER BY definition.created_at, definition.id)
    FROM target_definitions definition
  ), '[]'::jsonb)
) AS proof
FROM target_tenant tenant`;

const response = await fetch(
  `https://api.supabase.com/v1/projects/${PROD_REF}/database/query`,
  {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ query: sql, read_only: true }),
    signal: AbortSignal.timeout(30_000),
  },
);
if (!response.ok) {
  throw new Error(`FVI Starter proof readback failed with HTTP ${response.status}`);
}

const rows = await response.json();
const raw = Array.isArray(rows) ? rows[0]?.proof : null;
if (
  !raw ||
  raw.tenant?.id !== TENANT_ID ||
  raw.tenant?.slug !== TENANT_SLUG ||
  raw.tenant?.environment !== "prod"
) {
  throw new Error("Expected PROD Assurance tenant proof was not returned");
}

function nullableString(value) {
  return value == null ? null : String(value);
}

function integer(value) {
  const normalized = Number(value ?? 0);
  return Number.isSafeInteger(normalized) && normalized >= 0 ? normalized : 0;
}

function auditEvent(event) {
  const counts = event?.safe_context_counts ?? {};
  return {
    id: String(event.id),
    action: String(event.action),
    actor_id: nullableString(event.actor_id),
    resource_type: nullableString(event.resource_type),
    resource_id: nullableString(event.resource_id),
    occurred_at: String(event.occurred_at),
    safe_context_counts: Object.fromEntries(
      ["rule_count", "matched", "exceptions", "total_rows"]
        .filter((key) => counts[key] != null)
        .map((key) => [key, integer(counts[key])]),
    ),
  };
}

const definitions = Array.isArray(raw.definitions)
  ? raw.definitions.map((definition) => ({
      id: String(definition.id),
      recon_code: String(definition.recon_code),
      status: String(definition.status),
      recon_type: String(definition.recon_type),
      creator_id: nullableString(definition.creator_id),
      interactive_quota_hits_this_hour: integer(definition.interactive_quota_hits_this_hour),
      starter_template_id: nullableString(definition.starter_template_id),
      starter_template_code: nullableString(definition.starter_template_code),
      side_mappings: Array.isArray(definition.side_mappings)
        ? definition.side_mappings.map((side) => ({
            side_id: String(side.side_id),
            source_id: nullableString(side.source_id),
            field_names: Array.isArray(side.field_names)
              ? side.field_names.map((field) => String(field))
              : [],
          }))
        : [],
      rule_count: integer(definition.rule_count),
      rule_kinds: Array.isArray(definition.rule_kinds)
        ? definition.rule_kinds.map((kind) => String(kind))
        : [],
      catalogue_install_count:
        definition.catalogue_install_count == null
          ? null
          : integer(definition.catalogue_install_count),
      installation_audit_events: Array.isArray(definition.installation_audit_events)
        ? definition.installation_audit_events.map(auditEvent)
        : [],
      runs: Array.isArray(definition.runs)
        ? definition.runs.map((run) => ({
            id: String(run.id),
            status: String(run.status),
            matched_count: integer(run.matched_count),
            exception_count: integer(run.exception_count),
            total_rows: integer(run.total_rows),
            started_at: String(run.started_at),
            completed_at: nullableString(run.completed_at),
            match_row_count: integer(run.match_row_count),
            exception_row_count: integer(run.exception_row_count),
            run_audit_events: Array.isArray(run.run_audit_events)
              ? run.run_audit_events.map(auditEvent)
              : [],
          }))
        : [],
    }))
  : [];

const displayedDefinition = definitions.find(
  (definition) => definition.recon_code === DISPLAYED_RECON_CODE,
);
const runs = definitions.flatMap((definition) => definition.runs);
const rowCountsReconcile = runs.every(
  (run) =>
    run.matched_count === run.match_row_count &&
    run.exception_count === run.exception_row_count,
);

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      read_only: true,
      project_ref: PROD_REF,
      tenant: {
        id: String(raw.tenant.id),
        slug: String(raw.tenant.slug),
        environment: String(raw.tenant.environment),
      },
      target_definition_name: DEFINITION_NAME,
      expected_displayed_recon_code: DISPLAYED_RECON_CODE,
      definition_match_count: integer(raw.definition_match_count),
      definitions,
      checks: {
        displayed_recon_code_found: Boolean(displayedDefinition),
        displayed_definition_has_two_sides_and_seven_rules:
          displayedDefinition?.side_mappings.length === 2 && displayedDefinition.rule_count === 7,
        corresponding_run_count: runs.length,
        persisted_run_counts_reconcile: runs.length > 0 && rowCountsReconcile,
      },
      credential_value_exposed: false,
    },
    null,
    2,
  )}\n`,
);
