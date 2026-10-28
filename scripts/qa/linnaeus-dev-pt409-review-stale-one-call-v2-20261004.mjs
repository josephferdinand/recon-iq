import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

const privateRoot = path.join(process.env.LOCALAPPDATA ?? "", "FVI-QA-Private-20260925");
const qaRoot = path.join(privateRoot, "governance-approval-hosted-20261002");
const linnaeusRoot = path.join(privateRoot, "Linnaeus-Items11-12-20261004");
const transport = JSON.parse(await readFile(path.join(privateRoot, "FVI-QA-TRANSPORT-DEV-20261002.json"), "utf8"));
const readiness = JSON.parse(await readFile(path.join(qaRoot, "DEV-SESSION-READINESS-2026-10-04T03-00-43-745Z.json"), "utf8"));
const workflow = JSON.parse(await readFile(path.join(qaRoot, "DEV-ACTUAL-WORKFLOW-20261004.json"), "utf8"));
const previousPreflight = JSON.parse(await readFile(path.join(linnaeusRoot, "DEV-REVIEW-STALE-READONLY-DIAGNOSTIC-20261004-v2.json"), "utf8"));
const release = JSON.parse(await readFile(path.resolve("docs/evidence/FVI_GOVERNANCE_PT409_RELEASE_2026-10-04.json"), "utf8"));
const devRelease = release.environments.find((entry) => entry.environment === "DEV");
if (release.status !== "DEPLOYED_SQL_ONLY_SINGLE_OWNED_REFUSAL_LIVE_PROVEN"
  || release.appsUnchanged?.dev !== "ce449c37-d9cd-4a7a-8d5f-032c881f4e95"
  || devRelease?.after?.[0]?.ledger !== 430 || devRelease.after[0].latest !== "20261004033000"
  || devRelease.sourceSha256 !== "12422f6fbc3c2a53efdf4c59f45edc58bd9a10901fedbca574b166184df25cd6") {
  throw new Error("Current paired DEV PT409 receipt mismatch; no request sent");
}
if (transport.projectRef !== "YOUR_PROJECT_REF" || workflow.status !== "ACTUAL-DEV-POSITIVE-WORKFLOW-PASS-OPEN-REFUSAL-AUDIT-GATES"
  || previousPreflight.http !== 200 || previousPreflight.reviewIdMatches !== true || previousPreflight.tenantMatches !== false
  || previousPreflight.outcome !== "revoked" || previousPreflight.version !== 2 || previousPreflight.snapshotCurrent !== false
  || previousPreflight.permittedActionCount !== 0 || previousPreflight.reviewerMatchesChecker !== true
  || workflow.revoke?.outcome !== "revoked" || workflow.revoke?.version !== 2 || !workflow.revoke.snapshot_hash) {
  throw new Error("Saved exact scoped closed-review preflight is not qualified; no decision sent");
}
const tenantId = "aa5ed999-69eb-41a0-a9c6-fbb439efcffe";
const reviewId = workflow.revoke_campaign.item_ids?.[0];
const checker = readiness.actors.find((actor) => actor.kind === "checker" && actor.current_role === "tenant_admin" && actor.real_aal2 === true && actor.status === undefined);
if (!checker || !reviewId) throw new Error("Existing independent checker or exact closed review missing; no decision sent");
const savedState = JSON.parse(await readFile(checker.storage_state, "utf8"));
const savedToken = (savedState.origins ?? []).flatMap((origin) => origin.localStorage ?? []).find((item) => item.name === `sb-${transport.projectRef}-auth-token`);
if (!savedToken) throw new Error("DEV project session state missing; no decision sent");
const session = JSON.parse(savedToken.value);
const claims = JSON.parse(Buffer.from(session.access_token.split(".")[1], "base64url").toString("utf8"));
if (claims.sub !== checker.user_id || claims.aal !== "aal2" || claims.exp * 1000 <= Date.now() + 600000) throw new Error("Checker session is expired or mismatched; no decision sent");
const headers = { apikey: transport.anonKey, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" };
const proof = {
  startedAt: new Date().toISOString(),
  tier: "LIVE_DEV_AUTHENTICATED_REVIEW_STALE_CONFLICT_AND_READBACK",
  release: { app: release.appsUnchanged.dev, ledger: 430, latest: "20261004033000" },
  actor: { role: "tenant_admin", independentChecker: true, realAal2: true },
  reviewIdSha256: createHash("sha256").update(reviewId).digest("hex"),
  tenantScopedGetPreflight: { http: 200, exactReviewId: true, reviewerMatchesChecker: true, outcome: "revoked", version: 2, snapshotCurrent: false, permittedActionCount: 0, tenantIdReturnedByDto: false },
  calls: { decisionRpc: 0, postReadGet: 0, auditRead: 0 },
  mutationIntent: "stale version1 decision against already revoked/version2 review; no mutation expected",
  result: "RUNNING",
  existingRolesOrFactorsChanged: false,
};
const evidencePath = path.join(linnaeusRoot, "DEV-PT409-REVIEW-STALE-ONE-CALL-20261004-v2.json");
await writeFile(evidencePath, JSON.stringify(proof, null, 2), { encoding: "utf8", mode: 0o600, flag: "wx" });
const save = () => writeFile(evidencePath, JSON.stringify(proof, null, 2), { encoding: "utf8", mode: 0o600 });
let stage = "single_stale_review_decision";
try {
  const requestKey = randomUUID();
  const started = performance.now();
  proof.calls.decisionRpc = 1;
  const decisionResponse = await fetch(`${transport.apiUrl}/rest/v1/rpc/governance_access_review_decide`, {
    method: "POST", headers,
    body: JSON.stringify({ _input: {
      tenant_id: tenantId,
      id: reviewId,
      expected_version: 1,
      snapshot_hash: workflow.revoke.snapshot_hash,
      decision: "retain",
      reason: "Owned DEV QA stale review-version changed-path verification; existing review is closed",
      request_key: requestKey,
    } }),
    signal: AbortSignal.timeout(8000),
  });
  proof.decision = { http: decisionResponse.status, code: null, elapsedMs: Math.round(performance.now() - started), attempts: 1 };
  const decisionBody = await decisionResponse.json().catch(() => ({}));
  proof.decision.code = decisionResponse.ok ? null : typeof decisionBody.code === "string" ? decisionBody.code : "not_returned";
  proof.requestKeySha256 = createHash("sha256").update(requestKey).digest("hex");

  stage = "same_review_postread";
  const readResponse = await fetch(`${transport.apiUrl}/rest/v1/rpc/governance_access_review_get`, {
    method: "POST", headers, body: JSON.stringify({ _input: { tenant_id: tenantId, id: reviewId } }), signal: AbortSignal.timeout(12000),
  });
  const after = readResponse.ok ? await readResponse.json() : null;
  proof.calls.postReadGet = 1;
  if (!readResponse.ok || after?.id !== reviewId || after?.reviewer_id !== checker.user_id
    || after?.outcome !== "revoked" || after?.version !== 2 || after?.snapshot_current !== false
    || after?.permitted_actions?.length !== 0) throw new Error("Review state changed after stale call; no retry or compensation attempted");
  proof.after = { outcome: after.outcome, version: after.version, snapshotCurrent: after.snapshot_current, permittedActionCount: 0 };

  stage = "same_tenant_denial_audit_read";
  const auditQuery = new URLSearchParams({
    select: "action,occurred_at", tenant_id: `eq.${tenantId}`, occurred_at: `gte.${proof.startedAt}`,
    action: "like.governance.*", "context->>outcome": "in.(denied,failed)",
  });
  const auditResponse = await fetch(`${transport.apiUrl}/rest/v1/audit_log?${auditQuery}`, {
    headers: { apikey: transport.anonKey, Authorization: `Bearer ${session.access_token}` }, signal: AbortSignal.timeout(12000),
  });
  proof.calls.auditRead = 1;
  const auditRows = auditResponse.ok ? await auditResponse.json() : [];
  proof.audit = {
    http: auditResponse.status,
    eventCount: Array.isArray(auditRows) ? auditRows.length : 0,
    actionKinds: [...new Set((Array.isArray(auditRows) ? auditRows : []).map((row) => typeof row.action === "string" && /^governance\.[a-z_.-]+$/iu.test(row.action) ? row.action : "other"))],
    outcome: !auditResponse.ok ? "READBACK_HTTP_FAILURE" : auditRows.length ? "DENIED_EVENT_PRESENT" : "NO_DURABLE_DENIED_EVENT",
  };
  proof.result = decisionResponse.status === 409 && proof.decision.code === "PT409"
    ? "LIVE_DEV_REVIEW_PT409_PASS_STATE_UNCHANGED" : "LIVE_DEV_REVIEW_CHANGED_PATH_UNEXPECTED_RESULT_NO_RETRY";
} catch (error) {
  proof.result = proof.calls.decisionRpc ? "LIVE_DEV_REVIEW_CHANGED_PATH_FAILED_NO_RETRY" : "BLOCKED_BEFORE_DECISION";
  proof.failure = { stage, errorName: error?.name ?? "Error", http: error?.status ?? null, code: error?.code ?? null };
} finally {
  proof.completedAt = new Date().toISOString();
  await save();
}

process.stdout.write(JSON.stringify({ evidencePath, result: proof.result, decision: proof.decision, after: proof.after, audit: proof.audit, attempts: proof.decision?.attempts ?? 0 }) + "\n");
