// FVI live ledger + release identity readback (READ-ONLY).
// Follows the sanctioned pattern in scripts/check-ledger.mjs: Supabase Management
// API, read_only:true, credential read from the owner vault at run time.
// Never prints the credential. Never writes to any database.
//
// Usage: node scripts/fvi-live-ledger-read.mjs

import { readFile } from "node:fs/promises";

const VAULT = "./.private/CREDENTIALS.md";
const vault = await readFile(VAULT, "utf8");
const tok = (vault.match(/sbp_[A-Za-z0-9]+/) ?? [])[0];
if (!tok) {
  console.error("BLOCKED: SUPABASE_ACCESS_TOKEN not found in vault.");
  process.exit(2);
}

const TARGETS = [
  { label: "PROD", ref: "YOUR_PROJECT_REF" },
  { label: "DEV", ref: "YOUR_PROJECT_REF" },
];

async function q(ref, sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { authorization: "Bearer " + tok, "content-type": "application/json" },
    body: JSON.stringify({ query: sql, read_only: true }),
  });
  return { status: r.status, body: await r.text() };
}

for (const t of TARGETS) {
  console.log(`\n=== ${t.label} (${t.ref}) ===`);
  const led = await q(
    t.ref,
    "select version from supabase_migrations.schema_migrations order by version desc limit 3",
  );
  console.log(`ledger_status=${led.status} ${led.body.replace(/\s+/g, " ").slice(0, 300)}`);

  const cnt = await q(t.ref, "select count(*)::int as n from supabase_migrations.schema_migrations");
  console.log(`ledger_count=${cnt.body.replace(/\s+/g, " ").slice(0, 120)}`);

  // 242354 / 242355 cutover presence — the P0 access spine
  for (const v of ["20260924235350", "20260924235351", "20260924235352", "20260924235353", "20260924235354", "20260924235355"]) {
    const r = await q(
      t.ref,
      `select exists(select 1 from supabase_migrations.schema_migrations where version='${v}') as applied`,
    );
    const applied = /"applied"\s*:\s*true/.test(r.body);
    console.log(`  ${v} applied=${applied}`);
  }
}
