import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const project = "YOUR_PROJECT_REF";
const vaultPath = process.env.FVI_VAULT_PATH ?? "";
if (!path.isAbsolute(vaultPath) || path.basename(vaultPath) !== "Falcon-Veritas-Keys.md") {
  throw new Error("Set the canonical FVI secured vault");
}
let stage = "preflight";
async function main() {
  const vault = await readFile(vaultPath, "utf8");
  const start = vault.indexOf("<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->");
  const end = vault.indexOf("<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->");
  if (start < 0 || end <= start) throw new Error("Canonical credentials unavailable");
  const row = vault.slice(start, end).split(/\r?\n/u).find((line) => line.startsWith("| `SUPABASE_ACCESS_TOKEN` |"));
  const token = row?.split("|")[2]?.trim().replace(/^`|`$/gu, "");
  if (!token) throw new Error("Management credential unavailable");
  async function api(suffix = "", init = {}) {
    return fetch(`https://api.supabase.com/v1/projects/${project}${suffix}`, {
      ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
  }
  async function query(sql) {
    const response = await api("/database/query", { method: "POST", body: JSON.stringify({ query: sql, read_only: true }) });
    if (!response.ok) throw new Error("Database readback unavailable");
    return (await response.json())[0];
  }
  const response = await api();
  if (!response.ok) throw new Error("Project readback unavailable");
  const target = await response.json();
  if (target.id !== project || !/falcon|veritas|fvi/iu.test(target.name ?? "")) throw new Error("FVI target identity mismatch");
  const before = await query(`select pg_postmaster_start_time() as started_at,
    (select count(*)::int from public.recon_runs where status::text in ('running','processing')) as recon_running,
    (select count(*)::int from public.recon_schedule_runs where status::text='running') as schedules_running,
    (select count(*)::int from public.data_prep_runs where status::text in ('running','processing')) as prep_running,
    (select count(*)::int from pg_stat_activity where backend_type='client backend' and state='active'
      and pid<>pg_backend_pid() and usename not in ('supabase_admin','supabase_replication_admin')) as active_client_queries`);
  const preflight = { target: "prod", ref: project, project_name: target.name, project_status: target.status, ...before };
  console.log(JSON.stringify({ preflight }));
  if (process.env.FVI_ALLOW_PROD_SERVICE_RESTART !== "YES") return;
  if (before.recon_running || before.schedules_running || before.prep_running || before.active_client_queries) {
    throw new Error("Active work prevents a controlled restart");
  }
  const receiptPath = "_e2e_run/fvi-prod-service-restart-20260914.json";
  const receipt = {
    project, reason: "Provider-confirmed PGRST303 issued-at-future fault; configuration reload did not resolve it",
    preflight, requested_at: new Date().toISOString(), request_status: "dispatching", observations: [],
  };
  // A retained receipt prevents accidental duplicate restart requests. If a
  // response is uncertain, inspect the same project's live state; never resend.
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
  stage = "restart_request";
  let restart;
  try { restart = await api("/restart", { method: "POST" }); }
  catch {
    receipt.request_status = "uncertain";
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    throw new Error("Restart response uncertain; inspect live project before any further action");
  }
  receipt.request_status = restart.ok ? "accepted" : `http_${restart.status}`;
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ restart_request: receipt.request_status, ref: project }));
  if (!restart.ok) throw new Error("Restart request rejected");
  stage = "same_project_recovery_readback";
  for (let attempt = 0; attempt < 24; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    try {
      const healthResponse = await api("/health?services=db,rest,auth,storage");
      if ([400, 401, 403].includes(healthResponse.status)) {
        console.log(JSON.stringify({ recovery_verified: false, ref: project, health_request_status: healthResponse.status, restart_resubmitted: false }));
        process.exitCode = 1;
        return;
      }
      const body = healthResponse.ok ? await healthResponse.json() : [];
      const health = Array.isArray(body) ? body.map((item) => ({ name: item.name, healthy: item.healthy, status: item.status })) : [];
      const after = await query("select pg_postmaster_start_time() as started_at");
      const observation = { at: new Date().toISOString(), started_at: after.started_at, health_request_status: healthResponse.status, health };
      receipt.observations.push(observation);
      await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
      if (Date.parse(after.started_at) > Date.parse(before.started_at)
        && health.length === 4 && health.every((item) => item.healthy === true || item.status === "ACTIVE_HEALTHY")) {
        console.log(JSON.stringify({ recovered: true, ref: project, ...observation, receipt: receiptPath }));
        return;
      }
    } catch {
      // Read-only observation can fail briefly during the one accepted restart.
    }
  }
  console.log(JSON.stringify({ recovery_verified: false, ref: project, receipt: receiptPath, restart_resubmitted: false }));
  process.exitCode = 1;
}
await main().catch((error) => {
  console.error(JSON.stringify({ ok: false, stage, error_name: error?.name ?? "Error" }));
  process.exitCode = 1;
});
