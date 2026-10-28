import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const privateRoot = path.join(process.env.LOCALAPPDATA ?? "", "FVI-QA-Private-20260925");
const qaRoot = path.join(privateRoot, "governance-approval-hosted-20261002");
const linnaeusRoot = path.join(privateRoot, "Linnaeus-Items11-12-20261004");
const transport = JSON.parse(await readFile(path.join(privateRoot, "FVI-QA-TRANSPORT-DEV-20261002.json"), "utf8"));
const analyst = JSON.parse(await readFile(path.join(qaRoot, "DEV-ANALYST-PROVISION-20261004.json"), "utf8"));
const readiness = JSON.parse(await readFile(path.join(qaRoot, "DEV-SESSION-READINESS-2026-10-04T03-00-43-745Z.json"), "utf8"));
const refusal = JSON.parse(await readFile(path.join(linnaeusRoot, "DEV-PT409-STALE-ONE-CALL-20261004.json"), "utf8"));
if (refusal.result !== "LIVE_DEV_PT409_PASS_UNCHANGED_WITHDRAWN_VERSION2" || refusal.rpc.exactHttp !== 409 || refusal.rpc.exactCode !== "PT409") throw new Error("No exact DEV PT409 PASS receipt; no audit read issued");
const checker = readiness.actors.find((actor) => actor.kind === "checker" && actor.current_role === "tenant_admin" && actor.real_aal2 === true && actor.status === undefined);
if (!checker || !analyst.tenant_id || analyst.tenant_id !== "aa5ed999-69eb-41a0-a9c6-fbb439efcffe") throw new Error("Current DEV checker/owned tenant readiness missing; no audit read issued");
const state = JSON.parse(await readFile(checker.storage_state, "utf8"));
const storageItem = (state.origins ?? []).flatMap((origin) => origin.localStorage ?? []).find((item) => item.name === `sb-${transport.projectRef}-auth-token`);
if (!storageItem) throw new Error("Exact DEV project session state missing");
const session = JSON.parse(storageItem.value);
const claims = JSON.parse(Buffer.from(session.access_token.split(".")[1], "base64url").toString("utf8"));
if (claims.sub !== checker.user_id || claims.aal !== "aal2" || claims.exp * 1000 <= Date.now()) throw new Error("Saved checker state is not current matching AAL2");

const query = new URLSearchParams({
  select: "action,occurred_at",
  tenant_id: `eq.${analyst.tenant_id}`,
  occurred_at: `gte.${refusal.startedAt}`,
  action: "like.governance.*",
  "context->>outcome": "in.(denied,failed)",
});
const response = await fetch(`${transport.apiUrl}/rest/v1/audit_log?${query}`, {
  headers: { apikey: transport.anonKey, Authorization: `Bearer ${session.access_token}` },
  signal: AbortSignal.timeout(15000),
});
const responseBody = response.ok ? await response.json() : [];
const rows = Array.isArray(responseBody) ? responseBody : [];
const report = {
  capturedAt: new Date().toISOString(),
  target: "DEV ce449c37 / schema430",
  tier: "LIVE_READ_ONLY_SAME_TENANT_DENIAL_AUDIT_READBACK",
  refusalEvidence: "DEV-PT409-STALE-ONE-CALL-20261004.json",
  checkerRole: checker.current_role,
  checkerAal: "aal2",
  queryHttp: response.status,
  windowStart: refusal.startedAt,
  eventCount: rows.length,
  actionKinds: [...new Set(rows.map((row) => typeof row.action === "string" && /^governance\.[a-z_.-]+$/iu.test(row.action) ? row.action : "other"))],
  outcome: !response.ok ? "READBACK_HTTP_FAILURE"
    : rows.length ? "DENIED_EVENT_PRESENT"
      : "NO_DURABLE_DENIED_EVENT_AFTER_PT409",
  rawRowsPersisted: false,
  mutations: 0,
};
const evidencePath = path.join(linnaeusRoot, "DEV-PT409-DENIAL-AUDIT-READBACK-20261004.json");
await writeFile(evidencePath, JSON.stringify(report, null, 2), { encoding: "utf8", mode: 0o600, flag: "wx" });
process.stdout.write(JSON.stringify({ evidencePath, queryHttp: report.queryHttp, eventCount: report.eventCount, actionKinds: report.actionKinds, outcome: report.outcome, mutations: 0 }) + "\n");
