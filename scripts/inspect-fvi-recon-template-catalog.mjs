import { readFile } from "node:fs/promises";
import path from "node:path";

const target = process.env.FVI_TEMPLATE_TARGET ?? "prod";
const projectRef = { prod: "YOUR_PROJECT_REF", dev: "YOUR_PROJECT_REF" }[target];
if (!projectRef) throw new Error("FVI_TEMPLATE_TARGET must be prod or dev");
const vaultPath = process.env.FVI_VAULT_PATH ?? "";
if (!path.isAbsolute(vaultPath) || path.basename(vaultPath) !== "Falcon-Veritas-Keys.md") {
  throw new Error("Set FVI_VAULT_PATH to the canonical secured vault");
}
const markdown = await readFile(vaultPath, "utf8");
const section = markdown.slice(
  markdown.indexOf("<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->"),
  markdown.indexOf("<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->"),
);
const line = section.split(/\r?\n/u).find((candidate) => candidate.startsWith("| `SUPABASE_ACCESS_TOKEN` |"));
const token = line?.split("|")[2]?.trim().replace(/^`|`$/gu, "");
if (!token) throw new Error("Supabase Management API token is unavailable");

const sql = `select jsonb_build_object(
  'starter_templates',(select jsonb_agg(row_to_json(s) order by s.asset_class,s.code) from
    (select code,asset_class,title,legs,keys,rules,tolerances,sample_fields,status from public.recon_definition_templates) s),
  'marketplace_templates',(select jsonb_agg(row_to_json(m) order by m.slug) from
    (select t.slug,t.title,t.certification,t.spec_valid,t.current_version_id,v.status as version_status
     from public.mkt_templates t left join public.mkt_template_versions v on v.id=t.current_version_id) m)
) as catalogue`;
const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify({ query: sql, read_only: true }),
});
if (!response.ok) throw new Error(`Template catalogue query failed with HTTP ${response.status}`);
const catalogue = (await response.json())[0].catalogue;
const starters = catalogue.starter_templates ?? [];
const marketplace = catalogue.marketplace_templates ?? [];
const byAssetClass = Object.fromEntries([...new Set(starters.map((row) => row.asset_class))].sort()
  .map((assetClass) => [assetClass, starters.filter((row) => row.asset_class === assetClass).length]));
const ruleTypes = {};
for (const template of starters) {
  for (const rule of template.rules ?? []) {
    const kind = String(rule.type ?? rule.kind ?? "missing");
    ruleTypes[kind] = (ruleTypes[kind] ?? 0) + 1;
  }
}
if (process.env.FVI_STARTER_FIXTURE_EXPORT === "YES") {
  console.log(JSON.stringify({
    source: "FVI PROD published Starter Kit catalogue", captured_at: new Date().toISOString(),
    templates: starters,
  }));
} else console.log(JSON.stringify({
  target,
  starter_templates: starters.length,
  starter_published: starters.filter((row) => row.status === "published").length,
  starter_by_asset_class: byAssetClass,
  starter_rule_types: ruleTypes,
  one_sided_rule_details: starters.filter((row) => row.legs?.length === 1).map((row) => ({
    code: row.code, keys: row.keys, rules: row.rules, tolerances: row.tolerances,
  })).slice(0, 8),
  marketplace_templates: marketplace.length,
  marketplace_published_versions: marketplace.filter((row) => row.version_status === "published").length,
  marketplace_missing_current_version: marketplace.filter((row) => !row.current_version_id).length,
  marketplace_invalid_specs: marketplace.filter((row) => row.spec_valid === false).length,
}));
