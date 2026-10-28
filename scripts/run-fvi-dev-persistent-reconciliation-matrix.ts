import { createClient } from "@supabase/supabase-js";
import { executeReconSchedule } from "@/lib/recon-orchestrator.server";

const url = process.env.SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const expectedRef = process.env.FVI_EXPECTED_SUPABASE_REF ?? "";
if (process.env.FVI_ALLOW_DEV_PERSISTENT_RECON !== "YES") {
  throw new Error("Set FVI_ALLOW_DEV_PERSISTENT_RECON=YES for this controlled DEV mutation");
}
if (!expectedRef || new URL(url).hostname !== `${expectedRef}.supabase.co`) {
  throw new Error("Supabase target does not match the expected DEV project");
}
if (serviceKey.length < 40) throw new Error("Protected DEV service role is required");

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const tenantSlug = "fvi-validation-lab-20260904";

type DbRow = Record<string, unknown> & {
  id: string;
  last_run_id?: string | null;
  last_status?: string | null;
  matched_count?: number;
  exception_count?: number;
  total_rows?: number;
  status?: string;
};

async function requireOne(table: string, query: PromiseLike<{ data: unknown; error: { message: string } | null }>) {
  const { data, error } = await query;
  if (error) throw new Error(`${table}: ${error.message}`);
  if (!data) throw new Error(`${table}: expected one row`);
  return data as DbRow;
}

async function findOrInsert(table: string, name: string, insert: Record<string, unknown>) {
  const existing = await requireOne(
    `${table} lookup`,
    admin.from(table).select("*").eq("tenant_id", tenant.id).eq("name", name).maybeSingle(),
  ).catch((error) => {
    if (String(error).includes("expected one row")) return null;
    throw error;
  });
  if (existing) return existing;
  return requireOne(`${table} insert`, admin.from(table).insert(insert).select("*").single());
}

async function ensureUpload(sourceId: string, filename: string, rows: Array<Record<string, unknown>>) {
  const { data: existing, error: lookupError } = await admin
    .from("workspace_data_source_uploads")
    .select("id")
    .eq("data_source_id", sourceId)
    .eq("filename", filename)
    .maybeSingle();
  if (lookupError) throw new Error(`upload lookup: ${lookupError.message}`);
  if (existing) return existing.id;
  const columns = Object.keys(rows[0] ?? {}).map((name) => ({ name, type: name.includes("amount") ? "number" : name.includes("date") ? "date" : "string" }));
  const upload = await requireOne(
    "upload insert",
    admin.from("workspace_data_source_uploads").insert({
      tenant_id: tenant.id,
      data_source_id: sourceId,
      filename,
      mime_type: "application/json",
      size_bytes: JSON.stringify(rows).length,
      row_count: rows.length,
      rows,
      sample_rows: rows.slice(0, 3),
      columns,
      uploaded_by: actorUserId,
    }).select("id").single(),
  );
  await admin.from("workspace_data_sources").update({ status: "ready", row_count: rows.length, inferred_schema: columns }).eq("id", sourceId);
  return upload.id as string;
}

async function ensureScenario(input: {
  name: string;
  type: "one_sided" | "three_sided";
  sources: Array<{ label: string; rows: Array<Record<string, unknown>> }>;
  rules: Array<Record<string, unknown>>;
  expected: { matched: number; exceptions: number; total: number };
}) {
  const sourceRows = [];
  for (let index = 0; index < input.sources.length; index += 1) {
    const item = input.sources[index];
    const source = await findOrInsert("workspace_data_sources", item.label, {
      tenant_id: tenant.id,
      name: item.label,
      description: "Synthetic source retained for FVI DEV reconciliation validation.",
      source_type: "json",
      status: "ready",
      row_count: item.rows.length,
      created_by: actorUserId,
    });
    await ensureUpload(source.id, `${item.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`, item.rows);
    sourceRows.push({ side_id: String.fromCharCode(65 + index), label: item.label, data_source_id: source.id });
  }

  const definition = await findOrInsert("recon_definitions", input.name, {
    tenant_id: tenant.id,
    name: input.name,
    description: "Persistent synthetic DEV validation scenario.",
    recon_type: input.type,
    status: "active",
    visibility: "tenant",
    environment: "development",
    sides: sourceRows,
    rules: input.rules,
    created_by: actorUserId,
  });
  const schedule = await findOrInsert("recon_schedules", `${input.name} Manual Schedule`, {
    tenant_id: tenant.id,
    definition_id: definition.id,
    name: `${input.name} Manual Schedule`,
    cron_expression: "0 0 1 1 *",
    enabled: false,
    created_by: actorUserId,
  });

  let result: { recon_run_id: string | null; matched: number; exceptions: number; total_rows: number; ok: boolean };
  if (schedule.last_run_id && schedule.last_status === "completed") {
    const run = await requireOne("run lookup", admin.from("recon_runs").select("id,matched_count,exception_count,total_rows,status").eq("id", schedule.last_run_id).single());
    result = {
      recon_run_id: run.id,
      matched: Number(run.matched_count),
      exceptions: Number(run.exception_count),
      total_rows: Number(run.total_rows),
      ok: run.status === "completed",
    };
  } else {
    result = await executeReconSchedule(schedule.id, "manual", actorUserId);
  }
  if (!result.ok || result.matched !== input.expected.matched || result.exceptions !== input.expected.exceptions || result.total_rows !== input.expected.total) {
    throw new Error(`${input.name}: result mismatch ${JSON.stringify(result)}`);
  }
  return { name: input.name, run_id: result.recon_run_id, matched: result.matched, exceptions: result.exceptions, total_rows: result.total_rows };
}

const tenant = await requireOne("tenant", admin.from("tenants").select("id,slug").eq("slug", tenantSlug).single());
const actor = await requireOne("platform actor", admin.from("platform_roles").select("user_id").eq("role", "platform_admin").limit(1).single());
const actorUserId = actor.user_id as string;

const oneSided = await ensureScenario({
  name: "FVI Validation One-sided Controls 2026-09-04",
  type: "one_sided",
  sources: [{
    label: "FVI Validation One-sided Ledger",
    rows: [
      { reference: "VALID", value_date: "2026-08-01", amount: 1000 },
      { reference: "DUP", value_date: "2026-08-02", amount: 500 },
      { reference: "DUP", value_date: "2026-08-02", amount: 500 },
      { reference: "MISSING_DATE", value_date: null, amount: 250 },
    ],
  }],
  rules: [
    { id: "date-required", kind: "non_null", fields: { A: "value_date" }, description: "Value date required" },
    { id: "reference-unique", kind: "unique", fields: { A: "reference" }, description: "Business reference unique" },
  ],
  expected: { matched: 1, exceptions: 3, total: 4 },
});

const threeSided = await ensureScenario({
  name: "FVI Validation Three-sided Settlement 2026-09-04",
  type: "three_sided",
  sources: [
    { label: "FVI Validation Three-sided Ledger", rows: [{ group_id: "T1", amount: 1000 }, { group_id: "T2", amount: 500 }, { group_id: "T3", amount: 250 }] },
    { label: "FVI Validation Three-sided Bank", rows: [{ group_id: "T1", amount: 1000 }, { group_id: "T2", amount: 500 }, { group_id: "T3", amount: 250 }] },
    { label: "FVI Validation Three-sided Settlement", rows: [{ group_id: "T1", amount: 1000 }, { group_id: "T2", amount: 500 }, { group_id: "T3", amount: 245 }] },
  ],
  rules: [
    { id: "group", kind: "exact_match", fields: { A: "group_id", B: "group_id", C: "group_id" }, is_key: true },
    { id: "amount-sum", kind: "sum_to_match", fields: { A: "amount", B: "amount", C: "amount" }, params: { tolerance: 0.01 } },
  ],
  expected: { matched: 2, exceptions: 1, total: 9 },
});

const { data: chain, error: chainError } = await admin.rpc("verify_recon_evidence_chain", { _tenant_id: tenant.id });
if (chainError) throw new Error(`evidence chain: ${chainError.message}`);
if (!chain?.length || chain.some((row: { ok: boolean }) => row.ok !== true)) throw new Error("Evidence chain validation failed");

console.log(JSON.stringify({
  target: "DEV",
  tenant_slug: tenantSlug,
  retained: true,
  scenarios: [oneSided, threeSided],
  evidence_chain_rows: chain.length,
  evidence_chain_valid: true,
}, null, 2));
