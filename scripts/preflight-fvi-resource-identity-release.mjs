import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TARGETS = Object.freeze({
  prod: "YOUR_PROJECT_REF",
  dev: "YOUR_PROJECT_REF",
});

export const RESOURCES = Object.freeze([
  ["workspace_data_sources", "DS"],
  ["workspace_data_source_uploads", "UP"],
  ["data_source_schedules", "SCH"],
  ["rekon_db_connections", "DB"],
  ["rekon_inline_api_sources", "API"],
  ["erp_connector_configs", "ERP"],
  ["data_watchers", "FW"],
  ["aidp_templates", "AIDPT"],
  ["aidp_documents", "AIDPD"],
  ["reference_data_tables", "REF"],
].map(([table, prefix]) => ({ table, prefix, index: `${table}_tenant_public_id_uidx` })));

const BEGIN = "<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->";
const END = "<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->";
const MIGRATION_FILE = "20260924230000_data_resource_public_ids.sql";
const DEFAULT_VAULT = "./.private/CREDENTIALS.md";

export function parseCanonicalVault(markdown) {
  const begin = markdown.indexOf(BEGIN);
  const end = markdown.indexOf(END);
  if (begin < 0 || end <= begin) throw new Error("Canonical credential section unavailable");
  const row = markdown.slice(begin, end).split(/\r?\n/u)
    .find((line) => /^\|\s*`SUPABASE_ACCESS_TOKEN`\s*\|/u.test(line));
  const token = row?.split("|")[2]?.trim().replace(/^`|`$/gu, "");
  if (!/^sbp_[A-Za-z0-9_-]{20,}$/u.test(token ?? "")) {
    throw new Error("Management access unavailable in canonical credential section");
  }
  return token;
}

export function parseArgs(argv) {
  const values = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--help" || argv[i] === "-h") return { help: true };
    if (argv[i] !== "--project-ref" || !argv[i + 1] || argv[i + 1].startsWith("--")) {
      throw new Error("Usage: node scripts/preflight-fvi-resource-identity-release.mjs --project-ref <exact-fvi-ref>");
    }
    if (values.has(argv[i])) throw new Error("Specify --project-ref once");
    values.set(argv[i], argv[++i]);
  }
  const projectRef = values.get("--project-ref");
  const target = Object.entries(TARGETS).find(([, ref]) => ref === projectRef)?.[0];
  if (!target) throw new Error("--project-ref must exactly match a documented FVI PROD or DEV project ref");
  return { target, projectRef };
}

export function buildReadOnlyQuery(localMigrations) {
  const versions = localMigrations.map(({ version }) => `'${version.replaceAll("'", "''")}'`).join(", ") || "NULL";
  const expected = RESOURCES.map(({ table, prefix, index }) => `
    select '${table}'::text as table_name, '${prefix}'::text as id_prefix, '${index}'::text as index_name`).join("\n    union all");
  return `
with expected_resources as (
    ${expected}
), local_versions as (
    select unnest(array[${versions}]::text[]) as version
), ledger as (
    select version::text as version from supabase_migrations.schema_migrations
), table_state as (
    select e.table_name, e.id_prefix, e.index_name,
      c.oid is not null as relation_exists,
      coalesce(c.reltuples::bigint, 0) as estimated_rows,
      coalesce(pg_total_relation_size(c.oid), 0) as total_bytes,
      a.attname is not null as id_column_exists,
      p.attname is not null as public_id_exists,
      p.atttypid = 'text'::regtype as public_id_is_text,
      p.attgenerated = 's' as public_id_is_stored_generated,
      pg_get_expr(d.adbin, d.adrelid) as generated_expression,
      ix.oid is not null as index_exists,
      coalesce(i.indisunique, false) as index_is_unique,
      coalesce(i.indisvalid, false) as index_is_valid,
      pg_get_indexdef(i.indexrelid) as index_definition,
      has_table_privilege(current_user, c.oid, 'SELECT') as can_select
    from expected_resources e
    left join pg_class c on c.relnamespace = 'public'::regnamespace and c.relname = e.table_name and c.relkind in ('r','p')
    left join pg_attribute a on a.attrelid = c.oid and a.attname = 'id' and not a.attisdropped
    left join pg_attribute p on p.attrelid = c.oid and p.attname = 'public_id' and not p.attisdropped
    left join pg_attrdef d on d.adrelid = c.oid and d.adnum = p.attnum
    left join pg_class ix on ix.relnamespace = 'public'::regnamespace and ix.relname = e.index_name and ix.relkind = 'i'
    left join pg_index i on i.indexrelid = ix.oid and i.indrelid = c.oid
)
select jsonb_build_object(
  'server_version_num', current_setting('server_version_num'),
  'query_search_path', current_setting('search_path'),
  'ledger_count', (select count(*) from ledger),
  'ledger_latest_version', (select max(version) from ledger),
  'target_migration_applied', exists(select 1 from ledger where version = '${MIGRATION_FILE.slice(0, 14)}'),
  'local_versions_missing_remote', coalesce((select jsonb_agg(version order by version) from local_versions where version not in (select version from ledger)), '[]'::jsonb),
  'remote_versions_missing_local', coalesce((select jsonb_agg(version order by version) from ledger where version not in (select version from local_versions)), '[]'::jsonb),
  'tables', (select jsonb_agg(jsonb_build_object(
    'table', table_name, 'id_prefix', id_prefix, 'estimated_rows', estimated_rows, 'total_bytes', total_bytes,
    'relation_exists', relation_exists, 'id_column_exists', id_column_exists,
    'public_id_exists', public_id_exists, 'public_id_is_text', public_id_is_text, 'public_id_is_stored_generated', public_id_is_stored_generated,
    'generated_expression', generated_expression, 'index_exists', index_exists,
    'index_is_unique', index_is_unique, 'index_is_valid', index_is_valid,
    'index_definition', index_definition, 'can_select', can_select
  ) order by table_name) from table_state),
  'schema_usage', has_schema_privilege(current_user, 'public', 'USAGE'),
  'digest', jsonb_build_object(
    'visible_on_search_path', to_regprocedure('digest(text,text)') is not null,
    'executable_by_current_user', case when to_regprocedure('digest(text,text)') is null then false else has_function_privilege(current_user, to_regprocedure('digest(text,text)'), 'EXECUTE') end,
    'candidate_functions', coalesce((select jsonb_agg(jsonb_build_object(
      'schema', n.nspname, 'signature', pg_get_function_identity_arguments(p.oid),
      'executable_by_current_user', has_function_privilege(current_user, p.oid, 'EXECUTE')
    )) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where p.proname = 'digest' and pg_get_function_identity_arguments(p.oid) in ('bytea, text', 'text, text')), '[]'::jsonb)
  )
) as state`;
}

export async function collectLocalMigrations(migrationsDir) {
  const names = (await readdir(migrationsDir)).filter((name) => /^\d{14}_.+\.sql$/u.test(name)).sort();
  return Promise.all(names.map(async (name) => {
    const content = await readFile(path.join(migrationsDir, name));
    return { version: name.slice(0, 14), name, sha256: createHash("sha256").update(content).digest("hex") };
  }));
}

export function assessState(state, localMigrations) {
  const blockers = [];
  if (!state || !Array.isArray(state.tables) || state.tables.length !== RESOURCES.length) blockers.push("Incomplete catalog response");
  const missingPredecessors = (state?.local_versions_missing_remote ?? []).filter((version) => version < MIGRATION_FILE.slice(0, 14));
  if (missingPredecessors.length) blockers.push("Predecessor migrations are missing from the remote ledger");
  if (state?.remote_versions_missing_local?.length) blockers.push("Remote ledger contains versions without local migration files");
  if (!localMigrations.some(({ name }) => name === MIGRATION_FILE)) blockers.push("Target migration file is missing locally");
  if (!state?.schema_usage) blockers.push("Current database role lacks public schema USAGE");
  if (!state?.digest?.visible_on_search_path || !state?.digest?.executable_by_current_user) blockers.push("digest(text,text) is not resolvable and executable on the migration search_path");
  for (const table of state?.tables ?? []) {
    if (!table.relation_exists || !table.id_column_exists || !table.can_select) blockers.push(`${table.table}: relation, id column, or read ACL is not ready`);
    if (table.public_id_exists && (!table.public_id_is_text || !table.public_id_is_stored_generated || !validGeneratedExpression(table.generated_expression, table.id_prefix))) {
      blockers.push(`${table.table}: pre-existing public_id definition does not match the migration`);
    }
    if (table.index_exists && (!table.index_is_unique || !table.index_is_valid || !validIndexDefinition(table.index_definition))) {
      blockers.push(`${table.table}: pre-existing tenant/public_id index does not match the migration`);
    }
  }
  return { ready: blockers.length === 0, blockers };
}

function validGeneratedExpression(expression, prefix) {
  const normalized = String(expression ?? "").toLowerCase().replaceAll('"', "").replace(/::text/gu, "").replace(/\(id\)/gu, "id").replace(/\s+/gu, "");
  return normalized.includes(`'fvi-${prefix.toLowerCase()}-'`) && normalized.includes("upper(substr(encode(digest(id,'sha256'),'hex'),1,20))");
}

function validIndexDefinition(definition) {
  const normalized = String(definition ?? "").toLowerCase().replaceAll('"', "").replace(/\s+/gu, " ");
  return normalized.includes("unique index") && normalized.includes(" (tenant_id, public_id)");
}

export async function runPreflight({ projectRef, target, vaultPath = process.env.FVI_VAULT_PATH || DEFAULT_VAULT, repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), fetchImpl = fetch }) {
  if (TARGETS[target] !== projectRef) throw new Error("Project target/ref mismatch");
  if (!path.isAbsolute(vaultPath) || path.basename(vaultPath) !== "Falcon-Veritas-Keys.md") throw new Error("Set FVI_VAULT_PATH to the canonical secured vault");
  const token = parseCanonicalVault(await readFile(vaultPath, "utf8"));
  const localMigrations = await collectLocalMigrations(path.join(repoRoot, "supabase", "migrations"));
  const query = buildReadOnlyQuery(localMigrations);
  const state = await queryReadOnlyCatalog(fetchImpl, projectRef, token, query);
  const assessment = assessState(state, localMigrations);
  return {
    ok: assessment.ready, target, project_ref: projectRef, read_only: true,
    migration_count: localMigrations.length,
    target_migration_sha256: localMigrations.find(({ name }) => name === MIGRATION_FILE)?.sha256 ?? null,
    server_version_num: state?.server_version_num ?? null,
    query_search_path: state?.query_search_path ?? null,
    ledger_count: state?.ledger_count ?? null,
    ledger_latest_version: state?.ledger_latest_version ?? null,
    target_migration_applied: state?.target_migration_applied ?? false,
    local_versions_missing_remote: state?.local_versions_missing_remote ?? [],
    missing_predecessors: (state?.local_versions_missing_remote ?? []).filter((version) => version < MIGRATION_FILE.slice(0, 14)),
    pending_successors: (state?.local_versions_missing_remote ?? []).filter((version) => version > MIGRATION_FILE.slice(0, 14)),
    remote_versions_missing_local: state?.remote_versions_missing_local ?? [],
    tables: state?.tables ?? [], digest: state?.digest ?? null,
    schema_usage: state?.schema_usage ?? false, ready: assessment.ready, blockers: assessment.blockers,
  };
}

export async function queryReadOnlyCatalog(fetchImpl, projectRef, token, query) {
  if (!Object.values(TARGETS).includes(projectRef)) throw new Error("Project target/ref mismatch");
  const response = await fetchImpl(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ query, read_only: true }), signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    const sqlstate = errorText.match(/\b(?:ERROR:\s*)?([0-9A-Z]{5})\b/u)?.[1] ?? "unavailable";
    const category = /syntax error/iu.test(errorText) ? "syntax"
      : /does not exist/iu.test(errorText) ? "missing_object"
      : /permission denied/iu.test(errorText) ? "permission"
      : /timeout|canceling statement/iu.test(errorText) ? "timeout"
      : "unclassified";
    const missingColumn = errorText.match(/column\s+"?([a-z_.]{1,64})"?\s+does not exist/iu)?.[1] ?? "unavailable";
    const staticContext = errorText.match(/(?:column|function|relation)\s+[a-z_." ]{1,90}(?:does not exist|is ambiguous)/iu)?.[0]?.replace(/\s+/gu, " ") ?? "unavailable";
    throw new Error(`Read-only Management API query failed with HTTP ${response.status}, SQLSTATE ${sqlstate}, category ${category}, missing_column ${missingColumn}, context ${staticContext}`);
  }
  const result = await response.json();
  return Array.isArray(result) ? result[0]?.state : result?.state;
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log("Usage: node scripts/preflight-fvi-resource-identity-release.mjs --project-ref <YOUR_PROJECT_REF|YOUR_PROJECT_REF>\nOptional vault path: FVI_VAULT_PATH=<absolute canonical vault file>");
      return;
    }
    const result = await runPreflight({ ...args });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ready) process.exitCode = 2;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Preflight failed");
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
