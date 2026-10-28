import { readFile } from "node:fs/promises";
import path from "node:path";

const projects = { prod: "YOUR_PROJECT_REF", dev: "YOUR_PROJECT_REF" };
const patFile = process.env.FVI_SUPABASE_PAT_FILE ?? "";
const sourceTenantId = process.env.FVI_ENV_CHANGE_SOURCE_TENANT_ID ?? "";
if (!path.isAbsolute(patFile) || !/^[0-9a-f-]{36}$/u.test(sourceTenantId)) {
  throw new Error("Protected PAT and source tenant ID are required");
}
const accessToken = (await readFile(patFile, "utf8")).trim();
if (!/^sbp_[A-Za-z0-9_-]{20,}$/u.test(accessToken)) {
  throw new Error("Protected Management API token is unavailable");
}

async function query(projectRef, sql) {
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
  if (!response.ok) throw new Error(`Read-only identity query failed with HTTP ${response.status}`);
  return response.json();
}

const source = await query(
  projects.prod,
  `select encode(extensions.digest(convert_to(lower(u.email),'UTF8'),'sha256'),'hex') as email_hash,
    coalesce((u.raw_user_meta_data->>'synthetic_test_identity')::boolean,false) as synthetic,
    m.role::text as role
   from public.tenant_members m join auth.users u on u.id=m.user_id
   where m.tenant_id='${sourceTenantId}'::uuid and m.active order by email_hash`,
);
const target = await query(
  projects.dev,
  `select encode(extensions.digest(convert_to(lower(email),'UTF8'),'sha256'),'hex') as email_hash
   from auth.users`,
);
const targetHashes = new Set(target.map((row) => row.email_hash));
const missing = source
  .filter((row) => !targetHashes.has(row.email_hash))
  .map((row) => ({
    fingerprint: row.email_hash.slice(0, 12),
    synthetic: row.synthetic,
    role: row.role,
  }));
console.log(
  JSON.stringify({
    ok: true,
    read_only: true,
    source_members: source.length,
    mapped_members: source.length - missing.length,
    missing,
    safe_to_auto_provision: missing.length === 1 && missing[0].synthetic === true,
  }),
);
