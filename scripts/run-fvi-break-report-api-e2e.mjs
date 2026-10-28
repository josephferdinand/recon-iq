import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = (process.env.FVI_E2E_BASE_URL ?? "").replace(/\/+$/u, "");
const tenantSlug = process.env.FVI_E2E_TENANT_SLUG ?? "";
const reconId = process.env.FVI_E2E_RECON_ID ?? "";
const assigneeId = process.env.FVI_BREAK_REPORT_ASSIGNEE_ID ?? "";
const makerPath = path.resolve(process.env.FVI_BREAK_REPORT_MAKER_VAULT_PATH ?? "");
const checkerPath = path.resolve(process.env.FVI_BREAK_REPORT_CHECKER_VAULT_PATH ?? "");
const evidenceDir = path.resolve(process.env.FVI_BREAK_REPORT_EVIDENCE_DIR ?? "");
const allowedHosts = new Set(["app.reconiq.example", "dev.app.reconiq.example"]);

if (!baseUrl || !tenantSlug || !reconId || !assigneeId || !evidenceDir) {
  throw new Error("Set base URL, tenant slug, recon ID, assignee ID, and evidence directory");
}
const parsedBase = new URL(baseUrl);
if (parsedBase.protocol !== "https:" || !allowedHosts.has(parsedBase.hostname)) {
  throw new Error("FVI_E2E_BASE_URL must be a canonical FVI HTTPS origin");
}

async function readToken(file) {
  const text = await readFile(file, "utf8");
  const token = text.match(/^- API token: `([^`]+)`$/mu)?.[1] ?? "";
  if (!/^fvi_[0-9a-f]{48}$/u.test(token))
    throw new Error(`Malformed token vault file: ${path.basename(file)}`);
  return token;
}

const [maker, checker] = await Promise.all([readToken(makerPath), readToken(checkerPath)]);
const evidence = {
  base_url: baseUrl,
  tenant_slug: tenantSlug,
  recon_id: reconId,
  started_at: new Date().toISOString(),
  checks: [],
};
let sequence = 0;

async function request(name, route, { token = maker, method = "GET", body, idempotencyKey } = {}) {
  const headers = { authorization: `Bearer ${token}`, origin: baseUrl };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();
  const item = {
    sequence: ++sequence,
    name,
    method,
    route,
    status: response.status,
    content_type: contentType,
    retry_after: response.headers.get("retry-after"),
    body: payload,
  };
  evidence.checks.push(item);
  return item;
}

function expect(check, predicate, message) {
  check.passed = Boolean(predicate(check));
  if (!check.passed) throw new Error(`${message}: HTTP ${check.status}`);
}

const baseBreakRoute = `/api/v1/${tenantSlug}/recons/${reconId}/breaks`;

async function runThrottleProof() {
  const burst = await Promise.all(
    Array.from({ length: 65 }, (_, index) =>
      request(
        `throttle_${index + 1}`,
        `${baseBreakRoute}/00000000-0000-4000-8000-000000000000/actions`,
        {
          token: checker,
          method: "POST",
          body: { action: "reprocess" },
          idempotencyKey: `${tenantSlug}-throttle-${Date.now()}-${index}`,
        },
      ),
    ),
  );
  const unexpected = burst.filter((check) => ![404, 429].includes(check.status));
  const throttled = burst.filter((check) => check.status === 429 && check.retry_after).length;
  if (unexpected.length)
    throw new Error(
      `Unexpected throttle statuses: ${unexpected.map((item) => item.status).join(",")}`,
    );
  if (throttled === 0) throw new Error("Rate limiter did not return a controlled 429");
  return throttled;
}

if (process.env.FVI_BREAK_REPORT_THROTTLE_ONLY === "YES") {
  const throttled = await runThrottleProof();
  evidence.completed_at = new Date().toISOString();
  evidence.passed = true;
  evidence.summary = { checks: evidence.checks.length, throttled_requests: throttled };
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(
    path.join(evidenceDir, "throttle-results.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
    "utf8",
  );
  console.log(JSON.stringify({ ok: true, ...evidence.summary }));
  process.exit(0);
}

const listed = await request("list_breaks", `${baseBreakRoute}?limit=50`);
expect(
  listed,
  (item) => item.status === 200 && Array.isArray(item.body?.data) && item.body.data.length >= 3,
  "Break list unavailable",
);

const candidates = [];
for (const row of listed.body.data) {
  if (candidates.length >= 3) break;
  const detail = await request(
    `candidate_${candidates.length + 1}_detail`,
    `${baseBreakRoute}/${row.id}`,
  );
  expect(detail, (item) => item.status === 200, "Break detail unavailable");
  const pending = detail.body.write_off_requests?.some((entry) => entry.status === "pending");
  if (!pending && detail.body.data?.lifecycle_state !== "written_off")
    candidates.push(detail.body.data);
}
if (candidates.length < 3) throw new Error("Three mutable assurance breaks are required");
const [lifecycleBreak, approvalBreak, rejectionBreak] = candidates;

async function action(
  name,
  breakId,
  body,
  token = maker,
  key = `${tenantSlug}-${Date.now()}-${name}`,
) {
  return request(name, `${baseBreakRoute}/${breakId}/actions`, {
    token,
    method: "POST",
    body,
    idempotencyKey: key,
  });
}

expect(
  await action("assign", lifecycleBreak.id, { action: "assign", assignee: assigneeId }),
  (item) => item.status === 200 && item.body.data?.assignee === assigneeId,
  "Assign failed",
);
expect(
  await action("classify", lifecycleBreak.id, {
    action: "classify",
    root_cause: "Assurance counterparty timing variance",
    priority: "P2",
    tags: ["assurance", "timing"],
  }),
  (item) => item.status === 200 && item.body.data?.lifecycle_state === "investigating",
  "Classify failed",
);
const commentKey = `${tenantSlug}-${Date.now()}-comment-replay`;
const commentBody = {
  action: "comment",
  body: "Independent assurance comment retained for API evidence",
  internal: true,
};
const comment = await action("comment", lifecycleBreak.id, commentBody, maker, commentKey);
expect(comment, (item) => item.status === 201 && item.body.data?.id, "Comment failed");
const replay = await action("comment_replay", lifecycleBreak.id, commentBody, maker, commentKey);
expect(
  replay,
  (item) => item.status === 201 && item.body.data?.id === comment.body.data.id,
  "Idempotent replay failed",
);
const conflict = await action(
  "comment_conflict",
  lifecycleBreak.id,
  { ...commentBody, body: "Changed payload must conflict" },
  maker,
  commentKey,
);
expect(
  conflict,
  (item) => item.status === 409 && item.body?.error === "idempotency_conflict",
  "Idempotency conflict failed",
);
expect(
  await action("attach", lifecycleBreak.id, {
    action: "attach",
    filename: "FVI-Assurance-Evidence.csv",
    mime_type: "text/csv",
    size_bytes: 128,
  }),
  (item) => item.status === 201 && item.body.data?.id,
  "Attachment metadata failed",
);
expect(
  await action("resolve", lifecycleBreak.id, {
    action: "resolve",
    resolution_note: "Assurance adjustment independently verified",
    root_cause: "Counterparty timing variance",
  }),
  (item) => item.status === 200 && item.body.data?.lifecycle_state === "resolved",
  "Resolve failed",
);
expect(
  await action("reopen", lifecycleBreak.id, {
    action: "reopen",
    reason: "Assurance rerun validates reopen workflow",
  }),
  (item) => item.status === 200 && item.body.data?.lifecycle_state === "new",
  "Reopen failed",
);
expect(
  await action("reprocess", lifecycleBreak.id, { action: "reprocess" }),
  (item) => [200, 202].includes(item.status) && item.body?.job_id,
  "Reprocess enqueue failed",
);

const writeOff = await action("write_off_request", approvalBreak.id, {
  action: "write_off",
  reason: "Assurance-approved immaterial rounding variance",
  amount: 2.5,
  currency: "USD",
  gl_account: "6999",
});
expect(
  writeOff,
  (item) =>
    item.status === 202 &&
    item.body.data?.request_id &&
    item.body.data?.request_status === "pending",
  "Write-off request failed",
);
const requestId = writeOff.body.data.request_id;
expect(
  await action("maker_self_approval_denied", approvalBreak.id, {
    action: "approve_write_off",
    request_id: requestId,
    decision: "approved",
    decision_note: "Must fail for maker",
  }),
  (item) => item.status === 403 && item.body?.error === "independent_approval_required",
  "Maker self-approval was not denied",
);
expect(
  await action(
    "checker_approval",
    approvalBreak.id,
    {
      action: "approve_write_off",
      request_id: requestId,
      decision: "approved",
      decision_note: "Independent checker verified evidence",
    },
    checker,
  ),
  (item) => item.status === 200 && item.body.data?.decision_status === "approved",
  "Independent checker approval failed",
);

const rejectRequest = await action("write_off_reject_request", rejectionBreak.id, {
  action: "write_off",
  reason: "Assurance rejection-path request",
  amount: 7.5,
  currency: "USD",
  gl_account: "6998",
});
expect(
  rejectRequest,
  (item) =>
    item.status === 202 &&
    item.body.data?.request_id &&
    item.body.data?.request_status === "pending",
  "Rejection-path request failed",
);
expect(
  await action(
    "checker_rejection",
    rejectionBreak.id,
    {
      action: "approve_write_off",
      request_id: rejectRequest.body.data.request_id,
      decision: "rejected",
      decision_note: "Independent checker rejected insufficient basis",
    },
    checker,
  ),
  (item) => item.status === 200 && item.body.data?.decision_status === "rejected",
  "Independent checker rejection failed",
);

const finalApproval = await request(
  "approved_break_detail",
  `${baseBreakRoute}/${approvalBreak.id}`,
);
expect(
  finalApproval,
  (item) =>
    item.status === 200 &&
    item.body.data?.lifecycle_state === "written_off" &&
    item.body.write_off_requests?.some(
      (entry) => entry.id === requestId && entry.status === "approved",
    ),
  "Approved write-off readback failed",
);
const finalRejection = await request(
  "rejected_break_detail",
  `${baseBreakRoute}/${rejectionBreak.id}`,
);
expect(
  finalRejection,
  (item) =>
    item.status === 200 &&
    item.body.data?.lifecycle_state !== "written_off" &&
    item.body.write_off_requests?.some((entry) => entry.status === "rejected"),
  "Rejected write-off readback failed",
);

const reportRoot = `/api/v1/${tenantSlug}/reports`;
const catalogue = await request("report_catalogue", reportRoot);
expect(
  catalogue,
  (item) => item.status === 200 && item.body.standard?.length === 3,
  "Report catalogue failed",
);
for (const reportId of ["standard-operations", "standard-break-risk", "standard-full"]) {
  const report = await request(
    `report_${reportId}_json`,
    `${reportRoot}/${reportId}/run?format=json`,
    { method: "POST", body: { days: 180 } },
  );
  expect(
    report,
    (item) =>
      item.status === 200 && item.body.report_id === reportId && Array.isArray(item.body.data),
    `JSON report ${reportId} failed`,
  );
}
const csv = await request(
  "report_break_risk_csv",
  `${reportRoot}/standard-break-risk/run?format=csv`,
  { method: "POST", body: { days: 180 } },
);
expect(
  csv,
  (item) =>
    item.status === 200 &&
    item.content_type.includes("text/csv") &&
    typeof item.body === "string" &&
    item.body.includes("\n"),
  "CSV report failed",
);
const wrongTenant = await request(
  "wrong_tenant_denied",
  `/api/v1/not-the-assurance-tenant/reports`,
);
expect(wrongTenant, (item) => item.status === 403, "Tenant isolation failed");

const throttled =
  process.env.FVI_BREAK_REPORT_SKIP_THROTTLE === "YES" ? 0 : await runThrottleProof();
evidence.checks.push({
  sequence: ++sequence,
  name: "throttle_summary",
  status: 200,
  passed: true,
  skipped: throttled === 0,
  throttled_requests: throttled,
});

evidence.completed_at = new Date().toISOString();
evidence.passed = evidence.checks.every((item) => item.passed !== false);
evidence.summary = {
  checks: evidence.checks.length,
  lifecycle_break_id: lifecycleBreak.id,
  approved_write_off_break_id: approvalBreak.id,
  rejected_write_off_break_id: rejectionBreak.id,
  throttled_requests: throttled,
};
await mkdir(evidenceDir, { recursive: true });
await writeFile(
  path.join(evidenceDir, "results.json"),
  `${JSON.stringify(evidence, null, 2)}\n`,
  "utf8",
);
console.log(JSON.stringify({ ok: evidence.passed, ...evidence.summary }));
