import { readFile } from "node:fs/promises";
import path from "node:path";

const origin = "https://app.reconiq.example";
const slug = "reconiq-assurance-lab-prod";
const definitionId = "c939558c-23cf-4ffe-bf48-558cbb2ef457";
const idempotencyKey = "fvi-starter-vostro-20260915-retained-proof";
const mode = process.argv[2];
const jobId = process.argv[3];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
if (!["enqueue", "status"].includes(mode)) throw new Error("Choose enqueue or status");
if (mode === "enqueue" && process.env.FVI_ALLOW_STARTER_API_RUN !== "YES") {
  throw new Error("Set FVI_ALLOW_STARTER_API_RUN=YES for the retained synthetic PROD run");
}
if (mode === "status" && !uuid.test(jobId ?? "")) throw new Error("A valid observed job ID is required");
const tokenPath = process.env.FVI_WORKFLOW_API_TOKEN_VAULT_PATH ?? "";
if (!path.isAbsolute(tokenPath) || path.basename(tokenPath) !== "FVI-Assurance-Lab-Workflow-API.md") {
  throw new Error("Use the existing protected FVI workflow token file");
}
const token = (await readFile(tokenPath, "utf8")).match(/^- API token: `([^`]+)`$/mu)?.[1];
if (!token) throw new Error("Existing workflow token unavailable; no credential will be created or changed");
const route = mode === "enqueue"
  ? `/api/v1/${slug}/recons/${definitionId}/runs`
  : `/api/v1/${slug}/workflow-jobs/${jobId}`;
const response = await fetch(`${origin}${route}`, {
  method: mode === "enqueue" ? "POST" : "GET",
  headers: {
    authorization: `Bearer ${token}`,
    origin,
    ...(mode === "enqueue" ? { "idempotency-key": idempotencyKey } : {}),
  },
  redirect: "error",
  signal: AbortSignal.timeout(30_000),
});
const body = await response.json().catch(() => null);
const safeCode = (value) => typeof value === "string" && /^[a-z0-9_.-]{1,80}$/iu.test(value) ? value : null;
const returnedJob = uuid.test(body?.job_id ?? "") ? body.job_id : null;
const returnedRun = uuid.test(body?.result?.run_id ?? "") ? body.result.run_id : null;
if (mode === "status" && returnedJob && returnedJob !== jobId) {
  throw new Error("Returned workflow job identity does not match the requested job");
}
if (mode === "status" && body?.resource_id && body.resource_id !== definitionId) {
  throw new Error("Workflow job resource is not the retained Starter reconciliation");
}
const evidence = {
  observed_at: new Date().toISOString(),
  mode,
  request_path: route,
  definition_id: definitionId,
  idempotency_key: mode === "enqueue" ? idempotencyKey : undefined,
  http_status: response.status,
  job_id: returnedJob,
  job_status: safeCode(body?.status),
  idempotent_replay: typeof body?.idempotent_replay === "boolean" ? body.idempotent_replay : undefined,
  run_id: returnedRun,
  attempts: Number.isSafeInteger(body?.attempts) ? body.attempts : undefined,
  error_code: safeCode(body?.error),
  retry_after: response.headers.get("retry-after"),
};
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
if (![200, 202].includes(response.status) || !returnedJob) process.exitCode = 1;
