import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

if (process.env.FVI_RUN_CONNECTOR_API_NEGATIVE !== "YES") {
  throw new Error("Set FVI_RUN_CONNECTOR_API_NEGATIVE=YES for live negative connector assurance");
}

const baseUrl = (process.env.FVI_E2E_BASE_URL ?? "").replace(/\/+$/u, "");
const tenantSlug = process.env.FVI_E2E_TENANT_SLUG ?? "";
const directScheduleId = process.env.FVI_CONNECTOR_SCHEDULE_ID ?? "";
const gatewayScheduleId = process.env.FVI_GATEWAY_CONNECTOR_SCHEDULE_ID ?? "";
const connectorTokenFile = process.env.FVI_CONNECTOR_API_TOKEN_FILE ?? "";
const wrongScopeTokenFile = process.env.FVI_WRONG_SCOPE_API_TOKEN_FILE ?? "";
const allowedOrigin = process.env.FVI_E2E_ALLOWED_ORIGIN ?? "";

if (
  !/^https:\/\/(?:app|dev\.app|[0-9a-f]+\.fvi-app(?:-staging)?)\.falconveritas\.com$/u.test(
    baseUrl,
  ) &&
  !/^https:\/\/[0-9a-f]+\.fvi-app(?:-staging)?\.pages\.dev$/u.test(baseUrl)
) {
  throw new Error("FVI_E2E_BASE_URL must be a canonical or exact FVI deployment origin");
}
if (!/^[a-z0-9-]+$/u.test(tenantSlug)) throw new Error("Invalid tenant slug");
for (const [label, value] of [
  ["direct schedule", directScheduleId],
  ["gateway schedule", gatewayScheduleId],
]) {
  if (!/^[0-9a-f-]{36}$/iu.test(value)) throw new Error(`Invalid ${label} ID`);
}
for (const [label, value] of [
  ["connector token", connectorTokenFile],
  ["wrong-scope token", wrongScopeTokenFile],
]) {
  if (!path.isAbsolute(value) || path.extname(value).toLowerCase() !== ".md") {
    throw new Error(`${label} must use an absolute secured-vault Markdown path`);
  }
}
if (!/^https:\/\/(?:app|dev\.app)\.falconveritas\.com$/u.test(allowedOrigin)) {
  throw new Error("Allowed origin must be a canonical FVI application origin");
}

function tokenFrom(markdown) {
  return markdown.match(/^- API token: `([^`]+)`$/mu)?.[1] ?? "";
}

const connectorToken = tokenFrom(await readFile(connectorTokenFile, "utf8"));
const wrongScopeToken = tokenFrom(await readFile(wrongScopeTokenFile, "utf8"));
if (!connectorToken || !wrongScopeToken) throw new Error("Protected API token is unavailable");

const endpoint = (scheduleId, slug = tenantSlug) =>
  `${baseUrl}/api/v1/${slug}/connectors/${scheduleId}/runs`;
const request = (url, token, idempotencyKey, origin = allowedOrigin) =>
  fetch(url, {
    method: "POST",
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
      origin,
    },
  });

const wrongScope = await request(
  endpoint(directScheduleId),
  wrongScopeToken,
  `connector-negative-scope-${randomUUID()}`,
);
const gatewayDenied = await request(
  endpoint(gatewayScheduleId),
  connectorToken,
  `connector-negative-gateway-${randomUUID()}`,
);
const hostile = await request(
  endpoint(directScheduleId),
  "",
  `connector-negative-hostile-${randomUUID()}`,
  "https://attacker.example",
);
const allowedPreflight = await fetch(endpoint(directScheduleId), {
  method: "OPTIONS",
  headers: {
    origin: allowedOrigin,
    "access-control-request-method": "POST",
    "access-control-request-headers": "authorization,idempotency-key",
  },
});
const hostilePreflight = await fetch(endpoint(directScheduleId), {
  method: "OPTIONS",
  headers: {
    origin: "https://attacker.example",
    "access-control-request-method": "POST",
  },
});

const missingScheduleId = "00000000-0000-4000-8000-000000000000";
const burst = await Promise.all(
  Array.from({ length: 65 }, (_value, index) =>
    request(
      endpoint(missingScheduleId),
      connectorToken,
      `connector-throttle-${Date.now()}-${index + 1}`,
    ),
  ),
);
const statuses = burst.map((response) => response.status);
const evidence = {
  base_url: baseUrl,
  tenant_slug: tenantSlug,
  wrong_scope_status: wrongScope.status,
  gateway_required_status: gatewayDenied.status,
  hostile_status: hostile.status,
  hostile_cors: hostile.headers.get("access-control-allow-origin"),
  allowed_preflight_status: allowedPreflight.status,
  allowed_preflight_cors: allowedPreflight.headers.get("access-control-allow-origin"),
  hostile_preflight_status: hostilePreflight.status,
  hostile_preflight_cors: hostilePreflight.headers.get("access-control-allow-origin"),
  throttle_requests: statuses.length,
  throttle_404: statuses.filter((status) => status === 404).length,
  throttle_429: statuses.filter((status) => status === 429).length,
  throttle_unexpected: statuses.filter((status) => status !== 404 && status !== 429).length,
  throttle_retry_after_present: burst.some(
    (response) => response.status === 429 && Boolean(response.headers.get("retry-after")),
  ),
};

if (
  evidence.wrong_scope_status !== 403 ||
  evidence.gateway_required_status !== 404 ||
  evidence.hostile_status !== 401 ||
  evidence.hostile_cors !== null ||
  evidence.allowed_preflight_status !== 204 ||
  evidence.allowed_preflight_cors !== allowedOrigin ||
  evidence.hostile_preflight_status !== 204 ||
  evidence.hostile_preflight_cors !== null ||
  evidence.throttle_429 < 1 ||
  evidence.throttle_unexpected !== 0 ||
  !evidence.throttle_retry_after_present
) {
  throw new Error(`Connector API negative assurance failed: ${JSON.stringify(evidence)}`);
}

const evidenceDir = path.resolve("_e2e_run/owner-session/connector-api-assurance");
await mkdir(evidenceDir, { recursive: true });
await writeFile(
  path.join(evidenceDir, "negative-and-throttle-evidence.json"),
  `${JSON.stringify(evidence, null, 2)}\n`,
  "utf8",
);
console.log(JSON.stringify({ ok: true, ...evidence }));
