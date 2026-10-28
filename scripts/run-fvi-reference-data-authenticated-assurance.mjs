import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import path from "node:path";

const statePath = process.env.FVI_OWNER_STORAGE_STATE ?? "";
const anonPath = process.env.FVI_PROD_ANON_KEY_FILE ?? "";
if (!path.isAbsolute(statePath) || !path.isAbsolute(anonPath)) {
  throw new Error("Set absolute FVI_OWNER_STORAGE_STATE and FVI_PROD_ANON_KEY_FILE paths");
}
const state = JSON.parse(await readFile(statePath, "utf8"));
const values = (state.origins ?? []).flatMap((origin) => origin.localStorage ?? []);
let session = null;
for (const item of values) {
  try {
    const parsed = JSON.parse(item.value);
    const candidate = parsed?.access_token ? parsed : parsed?.currentSession ?? null;
    if (candidate?.access_token && candidate?.refresh_token) { session = candidate; break; }
  } catch { /* unrelated local-storage value */ }
}
if (!session) throw new Error("No Supabase session exists in the QA browser state");
const anon = (await readFile(anonPath, "utf8")).trim();
const client = createClient("https://YOUR_PROJECT_REF.supabase.co", anon, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const established = await client.auth.setSession({
  access_token: session.access_token,
  refresh_token: session.refresh_token,
});
if (established.error || !established.data.user) throw new Error("QA session could not be established");
const { data: tenant, error: tenantError } = await client
  .from("tenants").select("id").eq("slug", "reconiq-assurance-lab-prod").single();
if (tenantError || !tenant) throw new Error("Assurance tenant lookup failed");
const { data: table, error: tableError } = await client
  .from("reference_data_tables").select("id").eq("tenant_id", tenant.id).eq("name", "fx_spot_rates").single();
if (tableError || !table) throw new Error("Reference table lookup failed");
const { data: version, error: versionError } = await client
  .from("reference_data_versions").select("id,status").eq("tenant_id", tenant.id).eq("table_id", table.id)
  .order("version_number", { ascending: false }).limit(1).single();
if (versionError || !version) throw new Error("Reference version lookup failed");
let returnedStatus = version.status;
if (version.status === "draft") {
  const { data, error } = await client.rpc("submit_reference_data_version", {
    _tenant_id: tenant.id,
    _version_id: version.id,
  });
  if (error) throw new Error(`Authenticated submission failed: ${error.code ?? "unknown"}`);
  returnedStatus = data;
}
const { data: persisted, error: readbackError } = await client
  .from("reference_data_versions").select("status").eq("id", version.id).eq("tenant_id", tenant.id).single();
if (readbackError || persisted?.status !== "pending_approval") {
  throw new Error("Authenticated submission readback failed");
}
console.log(JSON.stringify({
  ok: true,
  project_ref: "YOUR_PROJECT_REF",
  table_id: table.id,
  version_id: version.id,
  status_before: version.status,
  status_returned: returnedStatus,
  status_after: persisted.status,
  session_user_present: true,
}));
