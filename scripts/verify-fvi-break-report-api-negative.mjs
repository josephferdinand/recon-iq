const baseUrl = (process.env.FVI_E2E_BASE_URL ?? "").replace(/\/+$/u, "");
const tenantSlug = process.env.FVI_E2E_TENANT_SLUG ?? "";
const reconId = process.env.FVI_E2E_RECON_ID ?? "";
const breakId = process.env.FVI_E2E_BREAK_ID ?? "";
const allowedOrigin = process.env.FVI_E2E_ALLOWED_ORIGIN ?? "";
const wrongScopeTokenFile = process.env.FVI_WRONG_SCOPE_TOKEN_FILE ?? "";
if (!baseUrl || !tenantSlug || !reconId || !breakId || !allowedOrigin) {
  throw new Error("Set base URL, tenant slug, recon ID, break ID, and allowed origin");
}

const paths = {
  reports: `/api/v1/${tenantSlug}/reports`,
  breaks: `/api/v1/${tenantSlug}/recons/${reconId}/breaks`,
  action: `/api/v1/${tenantSlug}/recons/${reconId}/breaks/${breakId}/actions`,
};
const checks = [];
for (const [name, path] of Object.entries(paths)) {
  const response = await fetch(`${baseUrl}${path}`, { method: name === "action" ? "POST" : "GET" });
  checks.push({ name: `${name}_missing_bearer`, passed: response.status === 401, status: response.status });
}
const allowed = await fetch(`${baseUrl}${paths.action}`, { method: "OPTIONS", headers: { origin: allowedOrigin } });
checks.push({
  name: "allowed_preflight",
  passed: allowed.status === 204 && allowed.headers.get("access-control-allow-origin") === allowedOrigin && allowed.headers.get("access-control-allow-headers")?.includes("idempotency-key"),
  status: allowed.status,
});
const hostile = await fetch(`${baseUrl}${paths.action}`, { method: "OPTIONS", headers: { origin: "https://attacker.example" } });
checks.push({ name: "hostile_preflight", passed: hostile.status === 204 && !hostile.headers.has("access-control-allow-origin"), status: hostile.status });

if (wrongScopeTokenFile) {
  const { readFile } = await import("node:fs/promises");
  const token = (await readFile(wrongScopeTokenFile, "utf8")).match(/^- API token: `([^`]+)`$/mu)?.[1] ?? "";
  if (!token) throw new Error("Wrong-scope token file is malformed");
  const headers = { authorization: `Bearer ${token}`, origin: allowedOrigin };
  const wrongReport = await fetch(`${baseUrl}${paths.reports}`, { headers });
  checks.push({ name: "reports_wrong_scope", passed: wrongReport.status === 403, status: wrongReport.status });
  const wrongAction = await fetch(`${baseUrl}${paths.action}`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json", "idempotency-key": "wrong-scope-proof" },
    body: JSON.stringify({ action: "reprocess" }),
  });
  checks.push({ name: "action_wrong_scope", passed: wrongAction.status === 403, status: wrongAction.status });
}

for (const check of checks) console.log(`${check.passed ? "PASS" : "FAIL"} ${check.name} HTTP ${check.status}`);
if (checks.some((check) => !check.passed)) process.exitCode = 1;
