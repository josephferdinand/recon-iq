import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const statePath = process.env.FVI_OWNER_STORAGE_STATE ?? "";
const anonPath = process.env.FVI_PROD_ANON_KEY_FILE ?? "";
if (!path.isAbsolute(statePath) || !path.isAbsolute(anonPath)) {
  throw new Error("Protected storage-state and PROD publishable-key paths must be absolute");
}
const state = JSON.parse(await readFile(statePath, "utf8"));
const session = (state.origins ?? []).flatMap((origin) => origin.localStorage ?? []).flatMap((item) => {
  try {
    const parsed = JSON.parse(item.value);
    return parsed?.access_token ? [parsed] : parsed?.currentSession?.access_token ? [parsed.currentSession] : [];
  } catch {
    return [];
  }
})[0];
if (!session?.access_token || !session?.refresh_token) throw new Error("Protected browser state has no Supabase session");
const anon = (await readFile(anonPath, "utf8")).trim();
const supabase = createClient("https://YOUR_PROJECT_REF.supabase.co", anon, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const established = await supabase.auth.setSession({
  access_token: session.access_token,
  refresh_token: session.refresh_token,
});
if (established.error || !established.data.user) throw new Error("Protected PROD session could not be established");
const { data: tenant, error: tenantError } = await supabase.from("tenants")
  .select("id").eq("slug", "reconiq-assurance-lab-prod").single();
if (tenantError || !tenant) throw new Error("PROD Assurance Lab tenant unavailable");
const { data: documents, error: documentError } = await supabase.from("aidp_documents")
  .select("id,original_filename,status,extraction").eq("tenant_id", tenant.id)
  .order("updated_at", { ascending: false }).limit(50);
if (documentError) throw documentError;
const results = [];
for (const document of documents ?? []) {
  const { count, error } = await supabase.from("aidp_outputs")
    .select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id)
    .eq("document_id", document.id).is("superseded_at", null);
  if (error) throw error;
  const { data: predictions, error: predictionError } = await supabase.from("aidp_predictions")
    .select("id,decision,status").eq("tenant_id", tenant.id).eq("document_id", document.id)
    .order("created_at", { ascending: false });
  if (predictionError) throw predictionError;
  const predictionIds = (predictions ?? []).map((prediction) => prediction.id);
  let pendingFields = 0;
  let acceptedFields = 0;
  let rejectedFields = 0;
  if (predictionIds.length > 0) {
    const { data: fields, error: fieldError } = await supabase.from("aidp_prediction_fields")
      .select("accepted_at,rejected_at").eq("tenant_id", tenant.id).in("prediction_id", predictionIds);
    if (fieldError) throw fieldError;
    pendingFields = (fields ?? []).filter((field) => !field.accepted_at && !field.rejected_at).length;
    acceptedFields = (fields ?? []).filter((field) => Boolean(field.accepted_at)).length;
    rejectedFields = (fields ?? []).filter((field) => Boolean(field.rejected_at)).length;
  }
  const extraction = document.extraction;
  const legacyShape = Array.isArray(extraction)
    ? "array"
    : extraction && typeof extraction === "object" && Object.keys(extraction).length > 0
      ? "object"
      : "empty";
  let currentOutputKeys = [];
  if ((count ?? 0) > 0) {
    const { data: outputKeys, error: outputKeyError } = await supabase.from("aidp_outputs")
      .select("aidp_entity_types!inner(key)").eq("tenant_id", tenant.id)
      .eq("document_id", document.id).is("superseded_at", null);
    if (outputKeyError) throw outputKeyError;
    currentOutputKeys = (outputKeys ?? []).flatMap((output) => {
      const entity = Array.isArray(output.aidp_entity_types)
        ? output.aidp_entity_types[0]
        : output.aidp_entity_types;
      return entity?.key ? [entity.key] : [];
    });
  }
  results.push({
    id: document.id,
    filename: document.original_filename,
    status: document.status,
    current_outputs: count ?? 0,
    legacy_extraction: legacyShape,
    predictions: (predictions ?? []).map((prediction) => ({ decision: prediction.decision, status: prediction.status })),
    pending_fields: pendingFields,
    accepted_fields: acceptedFields,
    rejected_fields: rejectedFields,
    current_output_keys: currentOutputKeys,
  });
}
const { data: mappingUsage, error: usageError } = await supabase.from("ai_usage_events")
  .select("model,tokens_in,tokens_out,cost_usd,created_at,meta")
  .eq("tenant_id", tenant.id).eq("scope", "schema_map")
  .order("created_at", { ascending: false }).limit(5);
if (usageError) throw usageError;
const aidpReconName = "Assurance | PROD | Reviewed AIDP Outputs Completeness | 2026-09-08";
const { data: aidpRecon, error: reconError } = await supabase.from("recon_definitions")
  .select("id,name,recon_type,status,sides,rules").eq("tenant_id", tenant.id)
  .eq("name", aidpReconName).maybeSingle();
if (reconError) throw reconError;
let aidpRun = null;
if (aidpRecon) {
  const { data: run, error: runError } = await supabase.from("recon_runs")
    .select("id,status,total_rows,matched_count,exception_count,stats,started_at")
    .eq("tenant_id", tenant.id).eq("definition_id", aidpRecon.id)
    .order("started_at", { ascending: false }).limit(1).maybeSingle();
  if (runError) throw runError;
  aidpRun = run;
}
console.log(JSON.stringify({
  ok: true,
  read_only: true,
  tenant_id: tenant.id,
  documents: results,
  natural_language_mapping_usage: mappingUsage ?? [],
  aidp_reconciliation: aidpRecon,
  aidp_latest_run: aidpRun,
}));
