import { createClient } from "@supabase/supabase-js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEV_REF = "YOUR_PROJECT_REF";

export function evaluateTeardownAudit(rows, residueIds = []) {
  const created = new Set(rows.filter((row) => row.event === "create").map((row) => row.tenant_id));
  const purged = new Set(rows.filter((row) => row.event === "purge").map((row) => row.tenant_id));
  const purgeFailed = rows.filter((row) => row.event === "purge_failed");
  const missingPurge = [...created].filter((id) => !purged.has(id));
  const residue = [...new Set(residueIds.filter((id) => created.has(id)))];

  return {
    created: created.size,
    purged: purged.size,
    purgeFailed: purgeFailed.length,
    missingPurge,
    residue,
    pass: purgeFailed.length === 0 && missingPurge.length === 0 && residue.length === 0,
  };
}

async function main() {
  const url = process.env.SUPABASE_URL ?? "";
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const startedAt = process.env.FVI_TEST_RUN_STARTED_AT ?? "";
  if (
    process.env.FVI_LIVE_TEST_TARGET !== "DEV" ||
    !url.includes(DEV_REF) ||
    url.includes("YOUR_PROJECT_REF")
  ) {
    throw new Error("Teardown verification is DEV-only");
  }
  if (!serviceRole || !startedAt || Number.isNaN(Date.parse(startedAt))) {
    throw new Error("Teardown verification requires service-role presence and a valid run start time");
  }

  const client = createClient(url, serviceRole, { auth: { persistSession: false } });
  const { data: rows, error: auditError } = await client
    .from("test_tenant_lifecycle_audit")
    .select("tenant_id,event")
    .gte("created_at", startedAt);
  if (auditError) throw new Error(`Unable to read teardown audit: ${auditError.message}`);

  const createdIds = [...new Set((rows ?? []).filter((row) => row.event === "create").map((row) => row.tenant_id))];
  let residueIds = [];
  if (createdIds.length > 0) {
    const { data: residue, error: residueError } = await client
      .from("tenants")
      .select("id")
      .in("id", createdIds);
    if (residueError) throw new Error(`Unable to verify tenant residue: ${residueError.message}`);
    residueIds = (residue ?? []).map((row) => row.id);
  }

  const report = evaluateTeardownAudit(rows ?? [], residueIds);
  console.log(`test_tenants_created=${report.created}`);
  console.log(`test_tenants_purged=${report.purged}`);
  console.log(`purge_failed_events=${report.purgeFailed}`);
  console.log(`tenant_residue=${report.residue.length}`);
  if (!report.pass) {
    throw new Error(
      `DEV teardown incomplete: missing_purge=${report.missingPurge.length} residue=${report.residue.length} purge_failed=${report.purgeFailed}`,
    );
  }
  console.log("PASS dev_live_test_teardown");
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) await main();
