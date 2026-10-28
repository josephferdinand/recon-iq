import { readFile } from "node:fs/promises";
import path from "node:path";

const targetName = process.env.FVI_RECON_IDENTIFIER_TARGET ?? "";
const target = {
  prod: { projectRef: "YOUR_PROJECT_REF", slug: "reconiq-assurance-lab-prod" },
  dev: { projectRef: "YOUR_PROJECT_REF", slug: "reconiq-assurance-lab-development" },
}[targetName];
if (!target) throw new Error("FVI_RECON_IDENTIFIER_TARGET must be prod or dev");
if (process.env.FVI_ALLOW_RECON_IDENTIFIER_PROOF !== "YES") {
  throw new Error("Set FVI_ALLOW_RECON_IDENTIFIER_PROOF=YES");
}

const vaultPath = process.env.FVI_VAULT_PATH ?? "";
if (!path.isAbsolute(vaultPath) || path.basename(vaultPath) !== "Falcon-Veritas-Keys.md") {
  throw new Error("Set FVI_VAULT_PATH to the canonical secured vault");
}

function vaultValue(markdown, key) {
  const start = markdown.indexOf("<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->");
  const end = markdown.indexOf("<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->");
  const line = markdown.slice(start, end).split(/\r?\n/u)
    .find((candidate) => candidate.startsWith(`| \`${key}\` |`));
  const value = line?.split("|")[2]?.trim().replace(/^`|`$/gu, "");
  if (!value) throw new Error(`Missing vault field ${key}`);
  return value;
}

const accessToken = vaultValue(await readFile(vaultPath, "utf8"), "SUPABASE_ACCESS_TOKEN");

async function query(sql, readOnly) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${target.projectRef}/database/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ query: sql, read_only: readOnly }),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`Management query failed with HTTP ${response.status}`);
  return JSON.parse(raw);
}

const tenants = await query(
  `select id from public.tenants where slug='${target.slug}' limit 1`,
  true,
);
const tenantId = tenants[0]?.id;
if (!tenantId) throw new Error("Assurance tenant is unavailable");

const stamp = new Date().toISOString().replace(/\D/gu, "").slice(0, 14);
const insert = (side) => query(
  `insert into public.recon_definitions(tenant_id,name,description,recon_type,sides,rules,status)
   values ('${tenantId}'::uuid,'Assurance | Concurrent Reconciliation ID | ${stamp} | ${side}',
     'Retained concurrency proof for immutable business identifiers','two_sided','[]','[]','draft')
   returning id,recon_code`,
  false,
);

const [leftRows, rightRows] = await Promise.all([insert("A"), insert("B")]);
const rows = [leftRows[0], rightRows[0]];
if (rows.some((row) => !row?.id || !/^FVI-GEN-2WAY-\d{6,}$/u.test(row.recon_code))) {
  throw new Error("Concurrent inserts did not return valid identifiers");
}
const sequences = rows.map((row) => Number(row.recon_code.split("-").at(-1))).sort((a, b) => a - b);
if (sequences[1] !== sequences[0] + 1 || rows[0].recon_code === rows[1].recon_code) {
  throw new Error("Concurrent identifiers are not unique consecutive values");
}

const auditValues = rows.map((row) =>
  `(null,'${tenantId}'::uuid,'system','recon.identifier.concurrency_proof','recon_definition','${row.id}',jsonb_build_object('recon_code','${row.recon_code}','proof_stamp','${stamp}'))`,
).join(",\n");
await query(
  `insert into public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context) values ${auditValues}`,
  false,
);
const readback = (await query(
  `select
    (select count(*)::integer from public.recon_definitions where id in ('${rows[0].id}','${rows[1].id}')) as definitions,
    (select count(*)::integer from public.audit_log where action='recon.identifier.concurrency_proof' and resource_id in ('${rows[0].id}','${rows[1].id}')) as audits`,
  true,
))[0];
if (readback.definitions !== 2 || readback.audits !== 2) throw new Error("Concurrency proof readback failed");

console.log(JSON.stringify({
  ok: true,
  target: targetName,
  tenant_slug: target.slug,
  identifiers: rows.map((row) => row.recon_code).sort(),
  consecutive: true,
  retained_definitions: readback.definitions,
  retained_audits: readback.audits,
}));
