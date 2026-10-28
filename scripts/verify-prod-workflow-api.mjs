import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function tokenFrom(markdown) {
  return markdown.match(/^- API token: `([^`]+)`$/mu)?.[1] ?? "";
}

const workflowVault = process.env.FVI_WORKFLOW_API_TOKEN_VAULT_PATH ?? "";
const aidpVault = process.env.FVI_AIDP_TOKEN_VAULT_PATH ?? "";
const pipelineId = process.env.FVI_WORKFLOW_API_PIPELINE_ID ?? "";
if (!path.isAbsolute(workflowVault) || !path.isAbsolute(aidpVault) || !pipelineId) {
  throw new Error("Set protected workflow/AIDP token paths and the Assurance pipeline ID");
}
const workflowToken = tokenFrom(await readFile(workflowVault, "utf8"));
const aidpToken = tokenFrom(await readFile(aidpVault, "utf8"));
if (!workflowToken || !aidpToken) throw new Error("Protected API token is unavailable");

const canonicalOrigin = "https://app.reconiq.example";
const route = `${canonicalOrigin}/api/v1/reconiq-assurance-lab-prod/data-prep/pipelines/${pipelineId}/runs`;
const request = (url, token, idempotencyKey, origin = canonicalOrigin) => fetch(url, {
  method: "POST",
  headers: {
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    "idempotency-key": idempotencyKey,
    origin,
  },
});

const missingAuth = await request(route, "", "negative-missing-auth");
const wrongTenant = await request(route.replace("reconiq-assurance-lab-prod", "wrong-tenant"), workflowToken, "negative-wrong-tenant");
const wrongScope = await request(route, aidpToken, "negative-wrong-scope");
const hostile = await request(route, "", "negative-hostile", "https://attacker.example");

const missingResource = route.replace(pipelineId, "00000000-0000-4000-8000-000000000000");
const burst = await Promise.all(
  Array.from({ length: 65 }, (_value, index) =>
    request(missingResource, workflowToken, `throttle-burst-${Date.now()}-${index + 1}`)),
);
const statuses = burst.map((response) => response.status);
const evidence = {
  missing_auth_status: missingAuth.status,
  missing_auth_cors: missingAuth.headers.get("access-control-allow-origin"),
  wrong_tenant_status: wrongTenant.status,
  wrong_scope_status: wrongScope.status,
  hostile_status: hostile.status,
  hostile_cors: hostile.headers.get("access-control-allow-origin"),
  throttle_requests: statuses.length,
  throttle_404: statuses.filter((status) => status === 404).length,
  throttle_429: statuses.filter((status) => status === 429).length,
  throttle_retry_after_present: burst.some(
    (response) => response.status === 429 && Boolean(response.headers.get("retry-after")),
  ),
};

if (
  evidence.missing_auth_status !== 401
  || evidence.missing_auth_cors !== canonicalOrigin
  || evidence.wrong_tenant_status !== 403
  || evidence.wrong_scope_status !== 403
  || evidence.hostile_status !== 401
  || evidence.hostile_cors !== null
  || evidence.throttle_429 < 1
  || !evidence.throttle_retry_after_present
) {
  throw new Error(`Workflow API negative assurance failed: ${JSON.stringify(evidence)}`);
}

const evidenceDir = path.resolve("_e2e_run/owner-session/workflow-api-assurance");
await mkdir(evidenceDir, { recursive: true });
await writeFile(path.join(evidenceDir, "negative-and-throttle-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
console.log(JSON.stringify(evidence));
