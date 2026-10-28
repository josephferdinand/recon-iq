import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_REF_PATTERN = /^[a-z]{20}$/u;

export const CATALOG_QUERY = String.raw`
with catalog as (
  select 'relation'::text as kind,
         format('%I.%I', n.nspname, c.relname) as key,
         md5(concat_ws('|', c.relkind, c.relpersistence, c.relrowsecurity, c.relforcerowsecurity)) as digest
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public', 'private')
     and c.relkind in ('r', 'p', 'v', 'm', 'S')
  union all
  select 'column',
         format('%I.%I.%I', n.nspname, c.relname, a.attname),
         md5(concat_ws('|', pg_catalog.format_type(a.atttypid, a.atttypmod), a.attnotnull,
                            coalesce(pg_get_expr(d.adbin, d.adrelid), ''), a.attidentity, a.attgenerated))
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where n.nspname in ('public', 'private')
     and c.relkind in ('r', 'p', 'v', 'm')
     and a.attnum > 0 and not a.attisdropped
  union all
  select 'constraint',
         format('%I.%I.%I', n.nspname, c.relname, x.conname),
         md5(concat_ws('|', x.contype, pg_get_constraintdef(x.oid, true), x.condeferrable, x.condeferred, x.convalidated))
    from pg_constraint x
    join pg_class c on c.oid = x.conrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public', 'private')
  union all
  select 'index',
         format('%I.%I', n.nspname, i.relname),
         md5(concat_ws('|', pg_get_indexdef(ix.indexrelid), ix.indisunique, ix.indisprimary, ix.indisvalid))
    from pg_index ix
    join pg_class i on i.oid = ix.indexrelid
    join pg_namespace n on n.oid = i.relnamespace
   where n.nspname in ('public', 'private')
  union all
  select case p.prokind when 'p' then 'procedure' else 'function' end,
         format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)),
         md5(pg_get_functiondef(p.oid))
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and p.prokind in ('f', 'p')
  union all
  select 'policy',
         format('%I.%I.%I', n.nspname, c.relname, p.polname),
         md5(concat_ws('|', p.polcmd, p.polpermissive,
                            array_to_string(array(select coalesce(r.rolname, 'public')
                                                   from unnest(p.polroles) role_oid
                                                   left join pg_roles r on r.oid = role_oid
                                                  order by 1), ','),
                            coalesce(pg_get_expr(p.polqual, p.polrelid), ''),
                            coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')))
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public', 'private')
  union all
  select 'trigger',
         format('%I.%I.%I', n.nspname, c.relname, t.tgname),
         md5(pg_get_triggerdef(t.oid, true))
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public', 'private') and not t.tgisinternal
  union all
  select 'type',
         format('%I.%I', n.nspname, t.typname),
         md5(concat_ws('|', t.typtype, pg_catalog.format_type(t.typbasetype, t.typtypmod),
                            coalesce((select string_agg(e.enumlabel, ',' order by e.enumsortorder)
                                      from pg_enum e where e.enumtypid = t.oid), '')))
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
   where n.nspname in ('public', 'private') and t.typtype in ('d', 'e')
)
select kind, key, digest from catalog order by kind, key`;

function readFlag(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

export function normalizeCatalogRows(rows) {
  if (!Array.isArray(rows)) throw new Error("Schema catalog did not return an array");
  const normalized = rows.map((row) => {
    const kind = String(row?.kind ?? "").trim();
    const key = String(row?.key ?? "").trim();
    const digest = String(row?.digest ?? "").trim();
    if (!/^[a-z]+$/u.test(kind) || !key || !/^[a-f0-9]{32}$/u.test(digest)) {
      throw new Error("Schema catalog returned an invalid row");
    }
    return { kind, key, digest };
  });
  const identities = normalized.map((row) => `${row.kind}\u0000${row.key}`);
  if (new Set(identities).size !== identities.length) {
    throw new Error("Schema catalog returned duplicate identities");
  }
  return normalized.sort((left, right) =>
    `${left.kind}\u0000${left.key}`.localeCompare(`${right.kind}\u0000${right.key}`, "en"),
  );
}

export function compareCatalogs(localRows, remoteRows) {
  const local = new Map(normalizeCatalogRows(localRows).map((row) => [`${row.kind}\u0000${row.key}`, row]));
  const remote = new Map(normalizeCatalogRows(remoteRows).map((row) => [`${row.kind}\u0000${row.key}`, row]));
  const missingRemote = [];
  const remoteOnly = [];
  const changed = [];

  for (const [identity, row] of local) {
    const peer = remote.get(identity);
    if (!peer) missingRemote.push(row);
    else if (peer.digest !== row.digest) changed.push({ kind: row.kind, key: row.key, localDigest: row.digest, remoteDigest: peer.digest });
  }
  for (const [identity, row] of remote) if (!local.has(identity)) remoteOnly.push(row);

  const counts = (rows) => Object.fromEntries(
    [...new Set(rows.map((row) => row.kind))].sort().map((kind) => [kind, rows.filter((row) => row.kind === kind).length]),
  );
  return {
    exact: missingRemote.length === 0 && remoteOnly.length === 0 && changed.length === 0,
    localCounts: counts([...local.values()]),
    remoteCounts: counts([...remote.values()]),
    missingRemote,
    remoteOnly,
    changed,
  };
}

export function applyRemoteOnlyAllowlist(comparison, entries) {
  if (!Array.isArray(entries)) throw new Error("Schema catalog allowlist must be an array");
  const allowedIdentities = new Set(entries.map((entry) => {
    const kind = String(entry?.kind ?? "").trim();
    const key = String(entry?.key ?? "").trim();
    const reason = String(entry?.reason ?? "").trim();
    if (!/^[a-z]+$/u.test(kind) || !key || !reason) {
      throw new Error("Invalid schema catalog allowlist entry");
    }
    return `${kind}\u0000${key}`;
  }));
  if (allowedIdentities.size !== entries.length) {
    throw new Error("Duplicate schema catalog allowlist entry");
  }

  const allowedRemoteOnly = comparison.remoteOnly.filter((row) =>
    allowedIdentities.has(`${row.kind}\u0000${row.key}`),
  );
  const unexpectedRemoteOnly = comparison.remoteOnly.filter((row) =>
    !allowedIdentities.has(`${row.kind}\u0000${row.key}`),
  );
  const observed = new Set(allowedRemoteOnly.map((row) => `${row.kind}\u0000${row.key}`));
  const unobservedAllowlist = entries.filter(
    (entry) => !observed.has(`${entry.kind}\u0000${entry.key}`),
  );
  return {
    ...comparison,
    exactApplicationSchema:
      comparison.missingRemote.length === 0 &&
      comparison.changed.length === 0 &&
      unexpectedRemoteOnly.length === 0,
    allowedRemoteOnly,
    unexpectedRemoteOnly,
    unobservedAllowlist,
  };
}

function queryLocalContainer({ container, password }) {
  if (!/^[a-zA-Z0-9_.-]+$/u.test(container ?? "")) throw new Error("Invalid local container name");
  if (!password) throw new Error("Local schema password is empty");
  const result = spawnSync(
    "docker",
    ["exec", "-e", `PGPASSWORD=${password}`, container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-A", "-F", "\t", "-t", "-v", "ON_ERROR_STOP=1", "-c", CATALOG_QUERY],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  if (result.status !== 0) throw new Error(`Local schema catalog query failed with exit ${result.status}`);
  return normalizeCatalogRows(
    result.stdout.trim().split(/\r?\n/u).filter(Boolean).map((line) => {
      const [kind, key, digest] = line.split("\t");
      return { kind, key, digest };
    }),
  );
}

async function queryRemote({ projectRef, accessToken, fetchImpl = fetch }) {
  if (!PROJECT_REF_PATTERN.test(projectRef ?? "")) throw new Error("Invalid Supabase project reference");
  if (!accessToken?.trim()) throw new Error("Supabase Management API token is empty");
  const response = await fetchImpl(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken.trim()}`, "content-type": "application/json" },
    body: JSON.stringify({ query: CATALOG_QUERY, read_only: true }),
  });
  if (!response.ok) throw new Error(`Remote schema catalog query failed with HTTP ${response.status}`);
  return normalizeCatalogRows(await response.json());
}

function sample(rows, limit = 20) {
  return rows.slice(0, limit).map(({ kind, key }) => `${kind}:${key}`);
}

async function main() {
  const projectRef = readFlag("--project-ref") ?? process.env.FVI_EXPECTED_SUPABASE_REF;
  const patFile = readFlag("--pat-file") ?? process.env.FVI_SUPABASE_PAT_FILE;
  const localContainer = readFlag("--local-container") ?? process.env.FVI_LOCAL_SCHEMA_CONTAINER;
  const localPassword = process.env.FVI_LOCAL_SCHEMA_PASSWORD;
  const outputFile = readFlag("--output") ?? process.env.FVI_SCHEMA_PARITY_REPORT;
  const allowlistFile = readFlag("--allow-remote-file") ?? process.env.FVI_SCHEMA_REMOTE_ALLOWLIST;
  if (!patFile || !outputFile) throw new Error("PAT file and output file are required");

  const accessToken = await readFile(path.resolve(patFile), "utf8");
  const allowlist = allowlistFile
    ? JSON.parse(await readFile(path.resolve(allowlistFile), "utf8"))
    : [];
  const [localRows, remoteRows] = await Promise.all([
    Promise.resolve(queryLocalContainer({ container: localContainer, password: localPassword })),
    queryRemote({ projectRef, accessToken }),
  ]);
  const comparison = applyRemoteOnlyAllowlist(compareCatalogs(localRows, remoteRows), allowlist);
  const report = {
    projectRef,
    generatedAt: new Date().toISOString(),
    queryMode: "read_only",
    ...comparison,
  };
  const resolvedOutput = path.resolve(outputFile);
  await mkdir(path.dirname(resolvedOutput), { recursive: true });
  await writeFile(resolvedOutput, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });

  console.log(`expected_project_ref=${projectRef}`);
  console.log(`local_catalog_rows=${localRows.length}`);
  console.log(`remote_catalog_rows=${remoteRows.length}`);
  console.log(`missing_remote=${comparison.missingRemote.length}`);
  console.log(`remote_only=${comparison.remoteOnly.length}`);
  console.log(`allowed_remote_only=${comparison.allowedRemoteOnly.length}`);
  console.log(`unexpected_remote_only=${comparison.unexpectedRemoteOnly.length}`);
  console.log(`changed=${comparison.changed.length}`);
  for (const [label, rows] of [["missing_remote_sample", comparison.missingRemote], ["remote_only_sample", comparison.remoteOnly], ["changed_sample", comparison.changed]]) {
    console.log(`${label}=${sample(rows).join(",") || "NONE"}`);
  }
  console.log(comparison.exactApplicationSchema ? "PASS exact_application_schema_catalog_parity" : "FAIL schema_catalog_drift");
  if (!comparison.exactApplicationSchema) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) await main();
