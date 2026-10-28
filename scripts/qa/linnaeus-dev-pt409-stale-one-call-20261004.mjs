import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHmac, createHash, randomUUID } from "node:crypto";

const privateRoot = path.join(process.env.LOCALAPPDATA ?? "", "FVI-QA-Private-20260925");
const qaRoot = path.join(privateRoot, "governance-approval-hosted-20261002");
const linnaeusRoot = path.join(privateRoot, "Linnaeus-Items11-12-20261004");
const transport = JSON.parse(await readFile(path.join(privateRoot, "FVI-QA-TRANSPORT-DEV-20261002.json"), "utf8"));
const provision = JSON.parse(await readFile(path.join(qaRoot, "DEV-ANALYST-PROVISION-20261004.json"), "utf8"));
const oldWorkflow = JSON.parse(await readFile(path.join(qaRoot, "DEV-ACTUAL-WORKFLOW-20261004.json"), "utf8"));
const release = JSON.parse(await readFile(path.resolve("docs/evidence/FVI_GOVERNANCE_PT409_RELEASE_2026-10-04.json"), "utf8"));
const devRelease = release.environments.find((entry) => entry.environment === "DEV");

if (release.status !== "DEPLOYED_SQL_ONLY_SINGLE_OWNED_REFUSAL_LIVE_PROVEN"
  || release.appsUnchanged?.dev !== "ce449c37-d9cd-4a7a-8d5f-032c881f4e95"
  || devRelease?.after?.[0]?.ledger !== 430
  || devRelease.after[0].latest !== "20261004033000"
  || devRelease.sourceSha256 !== "12422f6fbc3c2a53efdf4c59f45edc58bd9a10901fedbca574b166184df25cd6") {
  throw new Error("Current paired DEV PT409 receipt is absent or differs; no request sent");
}
if (provision.status !== "PASS" || provision.stage !== "ready" || provision.current_role !== "tenant_analyst"
  || provision.real_aal2 !== true || provision.tenant_id !== "aa5ed999-69eb-41a0-a9c6-fbb439efcffe"
  || provision.user_id !== oldWorkflow.withdrawal_requester_id && provision.withdrawal_requester_id) {
  if (provision.status !== "PASS" || provision.stage !== "ready" || provision.current_role !== "tenant_analyst" || provision.real_aal2 !== true) {
    throw new Error("Existing owned DEV analyst provision receipt is not ready; no request sent");
  }
}
if (transport.projectRef !== "YOUR_PROJECT_REF" || !transport.apiUrl || !transport.anonKey
  || !oldWorkflow.withdrawal_request_id
  || !oldWorkflow.steps?.some((step) => step.name === "withdraw_governance_membership_request" && step.stage === "result" && step.result?.status === "withdrawn" && step.result?.version === 2)) {
  throw new Error("Exact DEV target or previously completed withdrawn QA request missing; no request sent");
}

function totp(secret) {
  let bits = "";
  for (const char of secret.toUpperCase().replaceAll("=", "")) {
    const value = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(char);
    if (value < 0) throw new Error("Existing protected factor invalid");
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  return String((digest.readUInt32BE(digest[digest.length - 1] & 15) & 0x7fffffff) % 1000000).padStart(6, "0");
}

async function authPost(endpoint, body, token) {
  const response = await fetch(`${transport.apiUrl}/auth/v1/${endpoint}`, {
    method: "POST",
    headers: { apikey: transport.anonKey, "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error("Existing DEV QA authentication was refused"), { status: response.status, code: data.code ?? data.error_code ?? "other" });
  return data;
}

const proof = {
  startedAt: new Date().toISOString(),
  release: { app: release.appsUnchanged.dev, ledger: 430, latest: "20261004033000", sourceSha256: devRelease.sourceSha256 },
  actor: { roleExpected: "tenant_analyst", activeRoleVerified: false, realAal2Verified: false },
  preflight: { currentRequestVerified: false, businessCalls: 0 },
  rpc: { attempted: false, exactHttp: null, exactCode: null, elapsedMs: null, attempts: 0 },
  before: null,
  after: null,
  result: "RUNNING",
  secretsPersisted: false,
  accountRoleFactorChanges: false,
};
const evidencePath = path.join(linnaeusRoot, "DEV-PT409-STALE-ONE-CALL-20261004.json");
await writeFile(evidencePath, JSON.stringify(proof, null, 2), { encoding: "utf8", mode: 0o600, flag: "wx" });
const save = () => writeFile(evidencePath, JSON.stringify(proof, null, 2), { encoding: "utf8", mode: 0o600 });
let stage = "password_sign_in";

try {
  const signed = await authPost("token?grant_type=password", { email: provision.email, password: provision.password });
  if (signed.user?.id !== provision.user_id) throw new Error("Signed-in subject differs from the existing QA actor");
  stage = "existing_factor_challenge";
  const challenge = await authPost(`factors/${provision.factor_id}/challenge`, {}, signed.access_token);
  stage = "existing_factor_verify";
  const session = await authPost(`factors/${provision.factor_id}/verify`, { challenge_id: challenge.id, code: totp(provision.totp_secret) }, signed.access_token);
  const claims = JSON.parse(Buffer.from(session.access_token.split(".")[1], "base64url").toString("utf8"));
  if (claims.sub !== provision.user_id || claims.aal !== "aal2" || claims.exp * 1000 <= Date.now()) throw new Error("Fresh DEV actor assurance mismatch");
  proof.actor.realAal2Verified = true;
  proof.actor.sessionExpiresAt = new Date(claims.exp * 1000).toISOString();

  const headers = { apikey: transport.anonKey, Authorization: `Bearer ${session.access_token}` };
  stage = "current_role_readback";
  const membershipUrl = new URL(`${transport.apiUrl}/rest/v1/tenant_members`);
  membershipUrl.search = new URLSearchParams({ select: "user_id,tenant_id,role,active", user_id: `eq.${provision.user_id}`, tenant_id: `eq.${provision.tenant_id}` }).toString();
  const membershipResponse = await fetch(membershipUrl, { headers, signal: AbortSignal.timeout(15000) });
  const memberships = membershipResponse.ok ? await membershipResponse.json() : null;
  if (!Array.isArray(memberships) || memberships.length !== 1 || memberships[0].role !== "tenant_analyst" || memberships[0].active !== true) throw new Error("DEV ordinary actor current membership readback mismatch");
  proof.actor.activeRoleVerified = true;

  stage = "request_preflight";
  const rowUrl = new URL(`${transport.apiUrl}/rest/v1/governance_membership_requests`);
  rowUrl.search = new URLSearchParams({ select: "id,tenant_id,requested_by,status,version", id: `eq.${oldWorkflow.withdrawal_request_id}`, tenant_id: `eq.${provision.tenant_id}`, requested_by: `eq.${provision.user_id}` }).toString();
  const rowResponse = await fetch(rowUrl, { headers, signal: AbortSignal.timeout(15000) });
  const rows = rowResponse.ok ? await rowResponse.json() : null;
  if (!Array.isArray(rows) || rows.length !== 1 || rows[0].status !== "withdrawn" || rows[0].version !== 2
    || rows[0].requested_by !== provision.user_id || rows[0].tenant_id !== provision.tenant_id) {
    throw new Error("Previously owned request is not exactly withdrawn/version2 by this analyst; no RPC sent");
  }
  proof.preflight.currentRequestVerified = true;
  proof.preflight.requestIdSha256 = createHash("sha256").update(rows[0].id).digest("hex");
  proof.before = { status: rows[0].status, version: rows[0].version };
  await save();

  stage = "single_stale_withdrawal_rpc";
  const requestKey = randomUUID();
  const started = performance.now();
  proof.rpc.attempted = true;
  proof.rpc.attempts = 1;
  const rpcResponse = await fetch(`${transport.apiUrl}/rest/v1/rpc/withdraw_governance_membership_request`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      _tenant_id: provision.tenant_id,
      _request_id: oldWorkflow.withdrawal_request_id,
      _expected_version: 1,
      _reason: "Owned QA stale-withdrawal changed-path verification; existing request is closed",
      _request_key: requestKey,
    }),
    signal: AbortSignal.timeout(8000),
  });
  proof.rpc.elapsedMs = Math.round(performance.now() - started);
  proof.rpc.exactHttp = rpcResponse.status;
  const responseBody = await rpcResponse.json().catch(() => ({}));
  proof.rpc.exactCode = rpcResponse.ok ? null : (typeof responseBody.code === "string" ? responseBody.code : "not_returned");
  proof.rpc.requestKeySha256 = createHash("sha256").update(requestKey).digest("hex");
  proof.preflight.businessCalls = 1;

  stage = "same_row_postread";
  const afterResponse = await fetch(rowUrl, { headers, signal: AbortSignal.timeout(15000) });
  const afterRows = afterResponse.ok ? await afterResponse.json() : null;
  if (!Array.isArray(afterRows) || afterRows.length !== 1 || afterRows[0].status !== "withdrawn" || afterRows[0].version !== 2) throw new Error("Same request state changed after the stale call; no retry attempted");
  proof.after = { status: afterRows[0].status, version: afterRows[0].version };
  proof.result = rpcResponse.status === 409 && proof.rpc.exactCode === "PT409" ? "LIVE_DEV_PT409_PASS_UNCHANGED_WITHDRAWN_VERSION2" : "LIVE_DEV_CHANGED_PATH_UNEXPECTED_RESULT_NO_RETRY";
} catch (error) {
  proof.result = proof.rpc.attempted ? "LIVE_DEV_CHANGED_PATH_FAILED_NO_RETRY" : "BLOCKED_BEFORE_RPC";
  proof.failure = { stage, http: error?.status ?? null, code: error?.code ?? null, errorName: error?.name ?? "Error" };
} finally {
  proof.completedAt = new Date().toISOString();
  await save();
}

process.stdout.write(JSON.stringify({ evidencePath, result: proof.result, role: proof.actor.roleExpected, activeRoleVerified: proof.actor.activeRoleVerified, realAal2Verified: proof.actor.realAal2Verified, preflightVerified: proof.preflight.currentRequestVerified, attempted: proof.rpc.attempted, http: proof.rpc.exactHttp, code: proof.rpc.exactCode, elapsedMs: proof.rpc.elapsedMs, attempts: proof.rpc.attempts, before: proof.before, after: proof.after }) + "\n");
