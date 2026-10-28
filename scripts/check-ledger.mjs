import { readFile } from "node:fs/promises";
const vault = await readFile("./.private/CREDENTIALS.md", "utf8");
const tok = vault.match(/sbp_[A-Za-z0-9]+/)[0];
async function q(sql) {
  const r = await fetch("https://api.supabase.com/v1/projects/YOUR_PROJECT_REF/database/query", {
    method: "POST", headers: { authorization: "Bearer " + tok, "content-type": "application/json" },
    body: JSON.stringify({ query: sql, read_only: true })
  });
  const t = await r.text();
  return { status: r.status, body: t.slice(0, 4000) };
}
console.log("LEDGER:", await q("select version from supabase_migrations.schema_migrations order by version desc limit 5"));
console.log("FUNC:", await q("select pg_get_functiondef(to_regprocedure('public.transition_tenant_template_atomic(uuid,uuid,text)')) as def"));
