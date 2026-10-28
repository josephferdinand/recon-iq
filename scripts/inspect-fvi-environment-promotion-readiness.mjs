import { readFile } from "node:fs/promises";
import path from "node:path";

const patFile = process.env.FVI_SUPABASE_PAT_FILE ?? "";
if (!path.isAbsolute(patFile)) {
  throw new Error("FVI_SUPABASE_PAT_FILE must be an absolute protected file");
}
const accessToken = (await readFile(patFile, "utf8")).trim();
if (!/^sbp_[A-Za-z0-9_-]{20,}$/u.test(accessToken)) {
  throw new Error("Protected Management API token is unavailable");
}

const projects = {
  prod: "YOUR_PROJECT_REF",
  dev: "YOUR_PROJECT_REF",
};
const sql = `
select
  t.id,
  t.slug,
  t.name,
  t.family_id,
  t.environment,
  (select count(*) from public.recon_definitions r where r.tenant_id=t.id)::integer as reconciliations,
  (select count(*) from public.data_prep_pipelines p where p.tenant_id=t.id and p.lifecycle_state <> 'archived')::integer as data_prep_pipelines,
  (select count(*) from public.data_source_schedules s where s.tenant_id=t.id)::integer as connector_schedules,
  (select count(*) from public.data_watchers w where w.tenant_id=t.id)::integer as watchers
from public.tenants t
where t.slug like 'reconiq-assurance-lab-%'
order by t.slug`;

async function inspect(environment, projectRef) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query: sql, read_only: true }),
    },
  );
  if (!response.ok) {
    throw new Error(`Read-only ${environment} topology query failed with HTTP ${response.status}`);
  }
  return { environment, project_ref: projectRef, tenants: await response.json() };
}

const results = [];
for (const [environment, projectRef] of Object.entries(projects)) {
  results.push(await inspect(environment, projectRef));
}
console.log(JSON.stringify({ ok: true, read_only: true, results }));
