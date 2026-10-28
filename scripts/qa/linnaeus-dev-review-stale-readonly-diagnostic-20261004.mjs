import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const privateRoot = path.join(process.env.LOCALAPPDATA ?? "", "FVI-QA-Private-20260925");
const qaRoot = path.join(privateRoot, "governance-approval-hosted-20261002");
const outRoot = path.join(privateRoot, "Linnaeus-Items11-12-20261004");
const transport = JSON.parse(await readFile(path.join(privateRoot, "FVI-QA-TRANSPORT-DEV-20261002.json"), "utf8"));
const readiness = JSON.parse(await readFile(path.join(qaRoot, "DEV-SESSION-READINESS-2026-10-04T03-00-43-745Z.json"), "utf8"));
const workflow = JSON.parse(await readFile(path.join(qaRoot, "DEV-ACTUAL-WORKFLOW-20261004.json"), "utf8"));
const actor = readiness.actors.find((entry) => entry.kind === "checker" && entry.current_role === "tenant_admin" && entry.real_aal2 === true);
if (!actor || !workflow.revoke_campaign?.item_ids?.[0]) throw new Error("Saved exact QA preconditions unavailable");
const state = JSON.parse(await readFile(actor.storage_state, "utf8"));
const item = (state.origins ?? []).flatMap((origin) => origin.localStorage ?? []).find((entry) => entry.name === `sb-${transport.projectRef}-auth-token`);
if (!item) throw new Error("DEV token not found");
const token = JSON.parse(item.value).access_token;
const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
if (claims.sub !== actor.user_id || claims.aal !== "aal2" || claims.exp * 1000 <= Date.now()) throw new Error("Saved checker session is not current AAL2");
const tenantId = "aa5ed999-69eb-41a0-a9c6-fbb439efcffe";
const response = await fetch(`${transport.apiUrl}/rest/v1/rpc/governance_access_review_get`, {
  method: "POST",
  headers: { apikey: transport.anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ _input: { tenant_id: tenantId, id: workflow.revoke_campaign.item_ids[0] } }),
  signal: AbortSignal.timeout(12000),
});
const data = response.ok ? await response.json() : null;
const result = {
  at: new Date().toISOString(),
  release: "DEV ce449c37/schema430",
  tier: "LIVE_READ_ONLY_REVIEW_PREFLIGHT_DIAGNOSTIC",
  role: actor.current_role,
  aal2: true,
  http: response.status,
  reviewIdMatches: data?.id === workflow.revoke_campaign.item_ids[0],
  tenantMatches: data?.tenant_id === tenantId,
  status: data?.status ?? null,
  outcome: data?.outcome ?? null,
  version: Number.isInteger(data?.version) ? data.version : null,
  snapshotCurrent: typeof data?.snapshot_current === "boolean" ? data.snapshot_current : null,
  permittedActionCount: Array.isArray(data?.permitted_actions) ? data.permitted_actions.length : null,
  reviewSubjectMatchesChecker: data?.subject_user_id === actor.user_id,
  reviewerMatchesChecker: data?.reviewer_id === actor.user_id,
  resultBodyPersisted: false,
  mutations: 0,
};
const evidencePath = path.join(outRoot, "DEV-REVIEW-STALE-READONLY-DIAGNOSTIC-20261004-v2.json");
await writeFile(evidencePath, JSON.stringify(result, null, 2), { encoding: "utf8", mode: 0o600, flag: "wx" });
process.stdout.write(JSON.stringify({ evidencePath, http: result.http, reviewIdMatches: result.reviewIdMatches, tenantMatches: result.tenantMatches, status: result.status, outcome: result.outcome, version: result.version, snapshotCurrent: result.snapshotCurrent, permittedActionCount: result.permittedActionCount, reviewSubjectMatchesChecker: result.reviewSubjectMatchesChecker, reviewerMatchesChecker: result.reviewerMatchesChecker, mutations: 0 }) + "\n");
