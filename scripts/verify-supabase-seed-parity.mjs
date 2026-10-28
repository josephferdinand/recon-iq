import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_REF_PATTERN = /^[a-z]{20}$/u;
const TABLE_PATTERN = /^[a-z_][a-z0-9_]*$/u;
const NORMALIZED_ROW_DIGEST = "md5(coalesce((select jsonb_object_agg(e.key,e.value) from jsonb_each(to_jsonb(t)) e where e.key !~ '(^id$|_id$|_at$|^row_hash$|^prev_hash$|^fingerprint|^last4$)'), '{}'::jsonb)::text)";

function readFlag(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function queryLocal({ container, password, sql }) {
  if (!/^[a-zA-Z0-9_.-]+$/u.test(container ?? "")) throw new Error("Invalid local container name");
  if (!password) throw new Error("Local schema password is empty");
  const result = spawnSync(
    "docker",
    ["exec", "-i", "-e", `PGPASSWORD=${password}`, container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-A", "-F", "\t", "-t", "-v", "ON_ERROR_STOP=1"],
    { input: `${sql};\n`, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  if (result.status !== 0) throw new Error(`Local seed query failed with exit ${result.status}`);
  return result.stdout.trim().split(/\r?\n/u).filter(Boolean).map((line) => line.split("\t"));
}

async function queryRemote({ projectRef, accessToken, sql }) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken.trim()}`, "content-type": "application/json" },
    body: JSON.stringify({ query: sql, read_only: true }),
  });
  if (!response.ok) throw new Error(`Remote seed query failed with HTTP ${response.status}`);
  return response.json();
}

export function assessSeedParity({ localCounts, remoteCounts, fingerprintResults, allowlist }) {
  const allowed = new Set(allowlist.map((entry) => {
    if (!TABLE_PATTERN.test(entry?.table ?? "") || !String(entry?.reason ?? "").trim()) {
      throw new Error("Invalid mutable seed allowlist entry");
    }
    return entry.table;
  }));
  if (allowed.size !== allowlist.length) throw new Error("Duplicate mutable seed allowlist entry");
  const remote = new Map(remoteCounts.map((entry) => [entry.table, Number(entry.count)]));
  const deficits = localCounts.filter((entry) => Number(entry.count) > (remote.get(entry.table) ?? -1));
  const mismatches = fingerprintResults.filter((entry) => !entry.ok).map((entry) => entry.table);
  const allowedMismatches = mismatches.filter((table) => allowed.has(table));
  const unexpectedMismatches = mismatches.filter((table) => !allowed.has(table));
  return {
    passed: deficits.length === 0 && unexpectedMismatches.length === 0,
    deficits,
    exactFingerprintTables: fingerprintResults.length - mismatches.length,
    allowedMismatches,
    unexpectedMismatches,
  };
}

async function main() {
  const projectRef = readFlag("--project-ref") ?? process.env.FVI_EXPECTED_SUPABASE_REF;
  const patFile = readFlag("--pat-file") ?? process.env.FVI_SUPABASE_PAT_FILE;
  const container = readFlag("--local-container") ?? process.env.FVI_LOCAL_SCHEMA_CONTAINER;
  const password = process.env.FVI_LOCAL_SCHEMA_PASSWORD;
  const allowlistFile = readFlag("--mutable-allowlist") ?? process.env.FVI_SEED_MUTABLE_ALLOWLIST;
  const outputFile = readFlag("--output") ?? process.env.FVI_SEED_PARITY_REPORT;
  if (!PROJECT_REF_PATTERN.test(projectRef ?? "")) throw new Error("Invalid Supabase project reference");
  if (!patFile || !allowlistFile || !outputFile) throw new Error("PAT, mutable allowlist, and output files are required");

  const [accessToken, allowlist] = await Promise.all([
    readFile(path.resolve(patFile), "utf8"),
    readFile(path.resolve(allowlistFile), "utf8").then(JSON.parse),
  ]);
  const tableRows = queryLocal({
    container,
    password,
    sql: "select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by c.relname",
  });
  const tables = tableRows.flat().filter((table) => TABLE_PATTERN.test(table));
  const countSql = tables.map((table) =>
    `select '${table}'::text table_name, count(*)::bigint row_count from public.${table}`,
  ).join(" union all ");
  const localCounts = queryLocal({ container, password, sql: countSql })
    .map(([table, count]) => ({ table, count: Number(count) }))
    .filter((entry) => entry.count > 0);
  const remoteCounts = (await queryRemote({ projectRef, accessToken, sql: countSql }))
    .map((entry) => ({ table: entry.table_name, count: Number(entry.row_count) }));

  const hashSql = localCounts.map(({ table }) =>
    `select '${table}'::text table_name, ${NORMALIZED_ROW_DIGEST} digest from public.${table} t`,
  ).join(" union all ");
  const hashGroups = new Map();
  for (const [table, digest] of queryLocal({ container, password, sql: hashSql })) {
    if (!hashGroups.has(table)) hashGroups.set(table, new Set());
    hashGroups.get(table).add(digest);
  }
  const fingerprintSql = [...hashGroups.entries()].map(([table, digests]) => {
    const values = [...digests].map((digest) => `'${digest}'`).join(",");
    return `select '${table}'::text table_name, not exists(select 1 from unnest(array[${values}]::text[]) e(d) where not exists(select 1 from public.${table} t where ${NORMALIZED_ROW_DIGEST}=e.d)) ok`;
  }).join(" union all ");
  const fingerprintResults = (await queryRemote({ projectRef, accessToken, sql: fingerprintSql }))
    .map((entry) => ({ table: entry.table_name, ok: Boolean(entry.ok) }));
  const assessment = assessSeedParity({ localCounts, remoteCounts, fingerprintResults, allowlist });
  const report = {
    projectRef,
    generatedAt: new Date().toISOString(),
    queryMode: "read_only",
    seededTables: localCounts.length,
    exactFingerprintTables: assessment.exactFingerprintTables,
    mutableTables: assessment.allowedMismatches,
    countDeficitTables: assessment.deficits.map((entry) => entry.table),
    unexpectedFingerprintTables: assessment.unexpectedMismatches,
    passed: assessment.passed,
  };
  const resolvedOutput = path.resolve(outputFile);
  await mkdir(path.dirname(resolvedOutput), { recursive: true });
  await writeFile(resolvedOutput, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });

  console.log(`expected_project_ref=${projectRef}`);
  console.log(`seeded_tables=${report.seededTables}`);
  console.log(`exact_seed_fingerprint_tables=${report.exactFingerprintTables}`);
  console.log(`allowed_mutable_seed_tables=${report.mutableTables.length}`);
  console.log(`seed_count_deficits=${report.countDeficitTables.length}`);
  console.log(`unexpected_seed_fingerprint_mismatches=${report.unexpectedFingerprintTables.length}`);
  console.log(report.passed ? "PASS governed_seed_parity" : "FAIL seed_parity");
  if (!report.passed) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) await main();
