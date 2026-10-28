const baseUrl = (process.env.FVI_E2E_BASE_URL ?? "").replace(/\/+$/u, "");
const allowedOrigin = process.env.FVI_E2E_ALLOWED_ORIGIN ?? "https://app.reconiq.example";
if (!/^https:\/\/(?:[0-9a-f]{8}\.)?fvi-app\.pages\.dev$/u.test(baseUrl)
    && baseUrl !== "https://app.reconiq.example") {
  throw new Error("FVI_E2E_BASE_URL must be a canonical or exact FVI PROD deployment origin");
}

const path = "/api/v1/assurance-lab/reference-data/";
const checks = [];
async function check(name, requestPath, init, expectedStatus, expectedError, expectedOrigin) {
  const response = await fetch(`${baseUrl}${requestPath}`, init);
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
  const actualOrigin = response.headers.get("access-control-allow-origin");
  const passed = response.status === expectedStatus
    && (!expectedError || body.error === expectedError)
    && (expectedOrigin === undefined || actualOrigin === expectedOrigin);
  checks.push({ name, passed, status: response.status, error: body.error ?? null, cors: actualOrigin });
}

await check("allowed preflight", path, {
  method: "OPTIONS",
  headers: {
    Origin: allowedOrigin,
    "Access-Control-Request-Method": "GET",
    "Access-Control-Request-Headers": "authorization,content-type,idempotency-key",
  },
}, 204, null, allowedOrigin);
await check("missing bearer read", path, {
  headers: { Origin: allowedOrigin },
}, 401, "missing_bearer", allowedOrigin);
await check("missing bearer write", `${path}11111111-1111-4111-8111-111111111111/versions/`, {
  method: "POST",
  headers: { Origin: allowedOrigin, "content-type": "application/json", "idempotency-key": "negative-stage" },
  body: JSON.stringify({ rows: [{ alias: "USD" }], effective_from: "2026-09-08", change_note: "test" }),
}, 401, "missing_bearer", allowedOrigin);
await check("hostile origin denied", path, {
  headers: { Origin: "https://hostile.invalid" },
}, 401, "missing_bearer", null);
await check("invalid bearer denied", path, {
  headers: { Origin: allowedOrigin, Authorization: "Bearer invalid-reference-token" },
}, 401, "invalid_token", allowedOrigin);

for (const item of checks) {
  console.log(`${item.passed ? "PASS" : "FAIL"} ${item.name} status=${item.status} error=${item.error ?? "none"} cors=${item.cors ?? "none"}`);
}
if (checks.some((item) => !item.passed)) process.exitCode = 1;
