import { createClient } from "@supabase/supabase-js";
import { executeReconSchedule } from "@/lib/recon-orchestrator.server";

const url = process.env.SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? "";
const target = url.includes("YOUR_PROJECT_REF.supabase.co")
  ? "PROD"
  : url.includes("YOUR_PROJECT_REF.supabase.co")
    ? "DEV"
    : "UNKNOWN";
const allowed = target === "PROD"
  ? process.env.FVI_ALLOW_PROD_GOLDEN_PATH === "YES"
  : target === "DEV" && process.env.FVI_ALLOW_DEV_GOLDEN_PATH === "YES";

if (!allowed) {
  throw new Error(`Refusing golden-path run: explicit ${target} target authorization is missing`);
}
if (!serviceKey || !publishableKey) throw new Error("Required Supabase runtime credentials are missing");

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const anonymous = createClient(url, publishableKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const stamp = Date.now();
const slug = `codex-golden-${stamp}`;
let tenantId: string | null = null;
let runId: string | null = null;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Golden-path assertion failed: ${message}`);
}

async function insertOne(table: string, row: Record<string, unknown>) {
  const { data, error } = await admin.from(table).insert(row).select("*").single();
  if (error) throw new Error(`${table} fixture insert failed: ${error.message}`);
  return data as Record<string, unknown>;
}

const sideA = [
  { reference: "INV-001", amount: 100, txn_date: "2026-08-31" },
  { reference: "INV-002", amount: 200, txn_date: "2026-08-31" },
  { reference: "INV-003", amount: 300, txn_date: "2026-08-31" },
  { reference: "UNMATCHED-A", amount: 400, txn_date: "2026-08-31" },
];
const sideB = [
  { reference: "INV-001", amount: 100, txn_date: "2026-08-31" },
  { reference: "INV-002", amount: 200, txn_date: "2026-08-31" },
  { reference: "INV-003", amount: 300.01, txn_date: "2026-08-31" },
  { reference: "UNMATCHED-B", amount: 500, txn_date: "2026-08-31" },
];

try {
  const { data: actorRows, error: actorError } = await admin
    .from("platform_roles")
    .select("user_id")
    .eq("role", "platform_admin")
    .limit(1);
  if (actorError) throw new Error(`Platform actor lookup failed: ${actorError.message}`);
  const actorUserId = actorRows?.[0]?.user_id as string | undefined;
  assert(actorUserId, "a platform-admin actor is required for auditable fixture ownership");

  const tenant = await insertOne("tenants", {
    slug,
    name: "Codex Golden Path — Reversible PROD Fixture",
    environment: "prod",
    ai_enabled: false,
    created_by: actorUserId,
  });
  tenantId = tenant.id as string;

  const sourceA = await insertOne("workspace_data_sources", {
    tenant_id: tenantId,
    name: "Golden Path Ledger",
    source_type: "json",
    status: "ready",
    row_count: sideA.length,
    created_by: actorUserId,
  });
  const sourceB = await insertOne("workspace_data_sources", {
    tenant_id: tenantId,
    name: "Golden Path Statement",
    source_type: "json",
    status: "ready",
    row_count: sideB.length,
    created_by: actorUserId,
  });

  const definition = await insertOne("recon_definitions", {
    tenant_id: tenantId,
    name: "Codex Golden Path Exact + Tolerance",
    description: "Reversible production processing-integrity fixture",
    recon_type: "two_sided",
    status: "active",
    visibility: "tenant",
    environment: "production",
    created_by: actorUserId,
    sides: [
      { side_id: "A", label: "Ledger", data_source_id: sourceA.id },
      { side_id: "B", label: "Statement", data_source_id: sourceB.id },
    ],
    rules: [
      {
        id: "reference-key",
        kind: "exact_match",
        fields: { A: "reference", B: "reference" },
        is_key: true,
      },
      {
        id: "amount-tolerance",
        kind: "numeric_tolerance_abs",
        fields: { A: "amount", B: "amount" },
        params: { tolerance: 0.01 },
      },
    ],
  });

  for (const [source, rows, label] of [
    [sourceA, sideA, "ledger"],
    [sourceB, sideB, "statement"],
  ] as const) {
    await insertOne("workspace_data_source_uploads", {
      tenant_id: tenantId,
      data_source_id: source.id,
      filename: `golden-${label}.json`,
      mime_type: "application/json",
      size_bytes: JSON.stringify(rows).length,
      row_count: rows.length,
      rows,
      sample_rows: rows.slice(0, 2),
      columns: [
        { name: "reference", type: "string" },
        { name: "amount", type: "number" },
        { name: "txn_date", type: "date" },
      ],
      uploaded_by: actorUserId,
    });
  }

  const schedule = await insertOne("recon_schedules", {
    tenant_id: tenantId,
    definition_id: definition.id,
    name: "Codex Golden Path Manual Schedule",
    enabled: false,
    created_by: actorUserId,
  });

  const execution = await executeReconSchedule(schedule.id as string, "manual", actorUserId);
  assert(execution.ok, execution.error ?? "orchestrator returned not-ok");
  assert(execution.recon_run_id, "orchestrator did not return a run id");
  runId = execution.recon_run_id;
  assert(execution.matched === 3, `expected 3 match groups, observed ${execution.matched}`);
  assert(execution.exceptions === 2, `expected 2 exceptions, observed ${execution.exceptions}`);
  assert(execution.total_rows === 8, `expected 8 input rows, observed ${execution.total_rows}`);

  const [{ data: run }, { count: matchCount }, { count: exceptionCount }, { data: scheduleRun }] =
    await Promise.all([
      admin.from("recon_runs").select("status,matched_count,exception_count,total_rows,stats").eq("id", runId).single(),
      admin.from("recon_matches").select("id", { count: "exact", head: true }).eq("run_id", runId),
      admin.from("recon_exceptions").select("id", { count: "exact", head: true }).eq("run_id", runId),
      admin.from("recon_schedule_runs").select("status,matched_count,exception_count,total_rows").eq("recon_run_id", runId).single(),
    ]);
  assert(run?.status === "completed", "run status is not completed");
  assert(run.matched_count === 3 && matchCount === 3, "persisted match counts disagree");
  assert(run.exception_count === 2 && exceptionCount === 2, "persisted exception counts disagree");
  assert(run.total_rows === 8, "persisted input total is not 8");
  assert(scheduleRun?.status === "completed", "schedule run is not completed");

  const { data: packs, error: packError } = await admin
    .from("recon_run_evidence_packs")
    .select("id,match_count,exception_count,row_hash")
    .eq("run_id", runId);
  if (packError) throw new Error(`Evidence-pack read failed: ${packError.message}`);
  assert(packs?.length === 1, `expected one evidence pack, observed ${packs?.length ?? 0}`);
  assert(packs[0].match_count === 3 && packs[0].exception_count === 2, "evidence counts disagree");
  assert(Boolean(packs[0].row_hash), "evidence row hash is missing");

  const { data: chain, error: chainError } = await admin.rpc("verify_recon_evidence_chain", {
    _tenant_id: tenantId,
  });
  if (chainError) throw new Error(`Evidence-chain verification failed: ${chainError.message}`);
  assert(chain?.length === 1 && chain[0].ok === true, "evidence chain is not valid");

  const { data: anonymousRows, error: anonymousError } = await anonymous
    .from("recon_runs")
    .select("id")
    .eq("tenant_id", tenantId);
  assert(Boolean(anonymousError) || (anonymousRows?.length ?? 0) === 0, "anonymous caller observed fixture run");

  console.log(JSON.stringify({
    target,
    fixture: "reversible",
    inputs: 8,
    match_groups: 3,
    matched_records: 6,
    exceptions: 2,
    evidence_packs: 1,
    evidence_chain_valid: true,
    anonymous_isolation: true,
  }));
} finally {
  if (tenantId) {
    const { error } = await admin.rpc("purge_test_tenant", {
      _tenant_id: tenantId,
      _spec_name: "scripts/reconciliation-golden-path.ts",
    });
    if (error) {
      console.error(JSON.stringify({ cleanup: "FAIL", reason: error.message }));
      process.exitCode = 1;
    } else {
      const { count: tenantCount } = await admin
        .from("tenants")
        .select("id", { count: "exact", head: true })
        .eq("id", tenantId);
      const { count: runCount } = runId
        ? await admin.from("recon_runs").select("id", { count: "exact", head: true }).eq("id", runId)
        : { count: 0 };
      const clean = tenantCount === 0 && runCount === 0;
      console.log(JSON.stringify({
        cleanup: clean ? "PASS" : "FAIL",
        tenant_rows: tenantCount,
        run_rows: runCount,
      }));
      if (!clean) process.exitCode = 1;
    }
  }
}
