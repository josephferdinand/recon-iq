import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const privateRoot = path.resolve(process.env.LOCALAPPDATA ?? "", "FVI-QA-Private-20260925");
export const expectedMigrations = ["20261002133000", "20261002133100"];
export const cosmeticDeployments = { PROD: "cef2c7e7", DEV: "48e15093" };
export const expectedSupplementHashes = {
  PROD: "384111f02ee55e75a1db737459b472870ee692658e5f43316dd9dc1e127cd04d",
  DEV: "fbf8cfe4d037bbadbfec5d69afafccf3899c5f1c4ca74db228ac9a367df4b202",
};
export const expectedQualifiedHelpers = [
  "private.actor_can_read_bu", "private.data_resource_shadow_allows_actor", "private.has_platform_role",
  "private.recon_multi_bu_shadow_allows_actor", "public.audit_log_block_mutation", "public.audit_log_chain",
  "public.effective_user_permissions",
];
export const sourceFiles = [
  "src/components/governance-approval-queue.tsx",
  "src/components/governance-membership-approvals.tsx",
  "src/components/governance-access-reviews.tsx",
  "src/components/governance-audit-trail.tsx",
  "src/components/governance-review-detail.tsx",
  "src/lib/governance-membership.functions.ts",
  "src/lib/governance-access-review.functions.ts",
  "src/lib/governance-audit.functions.ts",
  "src/integrations/supabase/auth-middleware.ts",
  "src/routes/_authenticated/$slug/tenant.tsx",
  "src/routes/_authenticated/$slug/workspace.tsx",
  "src/lib/page-permissions.ts",
  "supabase/migrations/20261002133000_governance_membership_requests.sql",
  "supabase/migrations/20261002133100_governance_access_review_decisions.sql",
];

export function modeFromArgs(args = []) {
  if (args.includes("--execute")) return "execute";
  return "preflight";
}

export function safeSummary(value) {
  return JSON.stringify(value, (_key, item) => {
    if (typeof item === "string" && /^(eyJ[A-Za-z0-9_-]+\.|sb_(publishable|secret)_|Bearer )/u.test(item)) return "[redacted]";
    return item;
  }, 2);
}

export function assertSafeGovernanceCsv(csv) {
  const rows = []; let row = [], cell = "", quoted = false;
  const text = csv.replace(/^\uFEFF/u, "");
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted;
    } else if (char === "," && !quoted) { row.push(cell); cell = ""; }
    else if ((char === "\r" || char === "\n") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += char;
  }
  if (quoted) throw new Error("Audit CSV has an unclosed quoted field");
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const expected = ["occurred_at", "request_id", "review_id", "actor_name", "actor_role", "team_name", "scope_label", "environment", "action", "outcome", "reason", "version", "id", "correlation_id"];
  if (JSON.stringify(rows[0]) !== JSON.stringify(expected)) throw new Error("Audit CSV does not match the deployed allowlisted column contract");
  for (const values of rows.slice(1)) {
    if (values.length !== expected.length || values.some(value => /^[\s]*[=+@-]/u.test(value) || /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.|Bearer\s+\S+|sb_secret_/u.test(value))) throw new Error("Audit CSV contains an unsafe cell or unallowlisted shape");
  }
  return { rows: rows.length - 1, columns: expected.length };
}

function requirePrivatePath(value, label) {
  if (!value) throw new Error(`${label} is required`);
  const resolved = path.resolve(value);
  const relative = path.relative(privateRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`${label} must be under the protected FVI QA evidence directory`);
  return resolved;
}

export async function loadInputs(file = process.env.FVI_GOVERNANCE_QA_INPUT_FILE) {
  const inputPath = requirePrivatePath(file, "FVI_GOVERNANCE_QA_INPUT_FILE");
  const value = JSON.parse(await readFile(inputPath, "utf8"));
  const required = ["app_origin", "supabase_url", "publishable_key", "tenant_id", "tenant_slug", "bu_id", "workspace_id", "group_id", "permission_id", "actors"];
  for (const key of required) if (value[key] == null || value[key] === "") throw new Error(`QA input is missing ${key}`);
  const appUrl = new URL(value.app_origin);
  value.environment = value.environment ?? "PROD";
  value.membership_environment = value.membership_environment ?? (value.environment === "DEV" ? "dev" : "prod");
  if (!["prod", "dev", "sandbox", "uat"].includes(value.membership_environment)) throw new Error("membership_environment must be an actual registered environment enum");
  const expectedHost = value.environment === "PROD" ? "app.reconiq.example" : value.environment === "DEV" ? "dev.app.reconiq.example" : null;
  if (appUrl.protocol !== "https:" || !expectedHost || appUrl.hostname !== expectedHost || appUrl.pathname !== "/") throw new Error("Hosted QA environment and canonical application origin must match");
  value.app_origin = `${appUrl.origin}/`;
  const supabaseUrl = new URL(value.supabase_url);
  if (supabaseUrl.protocol !== "https:") throw new Error("Supabase target must use HTTPS");
  const targetTransport = JSON.parse(await readFile(path.join(privateRoot, value.environment === "DEV" ? "FVI-QA-TRANSPORT-DEV-20261002.json" : "FVI-QA-TRANSPORT-PROD-20261001.json"), "utf8"));
  if (supabaseUrl.origin !== new URL(targetTransport.apiUrl).origin) throw new Error("Caller transport does not belong to the selected PROD/DEV environment");
  if (String(value.publishable_key).startsWith("sb_secret_") || (!String(value.publishable_key).startsWith("sb_publishable_") && decodeJwt(value.publishable_key).role !== "anon")) throw new Error("Only a public publishable/anon key is permitted");
  if (!/^[0-9a-f-]{36}$/iu.test(value.tenant_id) || !/^[0-9a-f-]{36}$/iu.test(value.bu_id) || !/^[0-9a-f-]{36}$/iu.test(value.workspace_id) || !/^[0-9a-f-]{36}$/iu.test(value.group_id)) throw new Error("Tenant, BU, workspace and group IDs must be verified UUIDs");
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/u.test(value.tenant_slug)) throw new Error("tenant_slug is invalid");
  if (typeof value.permission_id !== "string" || !value.permission_id.trim()) throw new Error("permission_id must identify the exact permission granted only through the new QA group");
  const isolatedActorRoot = path.join(privateRoot, "governance-approval-hosted-20261002", "actors");
  for (const actor of ["requester", "maker", "checker", "observer", "lapsed"]) {
    if (!value.actors[actor]?.user_id || !value.actors[actor]?.storage_state) throw new Error(`actors.${actor} needs a verified QA user_id and isolated storage_state`);
    value.actors[actor].storage_state = requirePrivatePath(value.actors[actor].storage_state, `actors.${actor}.storage_state`);
    const relative = path.relative(isolatedActorRoot, value.actors[actor].storage_state);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`actors.${actor}.storage_state must be an isolated copy under the dedicated governance QA actors directory`);
  }
  if (value.actors.maker.user_id === value.actors.checker.user_id || [value.actors.maker.user_id, value.actors.checker.user_id].includes(value.actors.requester.user_id)) throw new Error("Requester, maker and checker must be independent QA identities");
  if (!["recon_definitions", "data_resource_registry"].includes(value.resource_probe?.table) || !/^[0-9a-f-]{36}$/iu.test(value.resource_probe?.id ?? "")) throw new Error("resource_probe needs an exact QA-owned recon_definitions or data_resource_registry UUID for real RLS read denial");
  return value;
}

export function validateGovernanceAck(ack, environment = "PROD") {
  if (ack.release_kind !== "governance" || ack.governance_ready !== true || ack.parent_explicit_ack !== true) throw new Error("Explicit parent acknowledgement of the new governance release is required");
  if (environment === "DEV" ? String(ack.dev_deployment_id ?? "").startsWith(cosmeticDeployments.DEV) : String(ack.production_deployment_id ?? "").startsWith(cosmeticDeployments.PROD)) throw new Error("Cosmetic CSS deployments cannot authorize governance writes");
  if (!ack.production_deployment_id || ack.production_hosted_readback !== true || ack.sql_verified !== true) throw new Error("Verified new governance SQL and production application readback are required");
}

export async function currentSourceHashes() {
  const hashes = {};
  for (const relative of sourceFiles) {
    const content = await readFile(path.join(repoRoot, relative));
    hashes[relative] = createHash("sha256").update(content).digest("hex");
  }
  return hashes;
}

export async function verifyReleaseAck(file = process.env.FVI_GOVERNANCE_RELEASE_ACK, environment = process.env.FVI_GOVERNANCE_CATALOG_ENV ?? "PROD") {
  const ackPath = requirePrivatePath(file, "FVI_GOVERNANCE_RELEASE_ACK");
  const ack = JSON.parse(await readFile(ackPath, "utf8"));
  validateGovernanceAck(ack, environment);
  if (environment === "DEV" && (!ack.dev_deployment_id || ack.dev_sql_verified !== true || ack.dev_hosted_readback !== true || ack.dev_host !== "https://dev.app.reconiq.example" || !String(ack.previous_dev_deployment ?? "").startsWith(cosmeticDeployments.DEV))) throw new Error("Explicit verified DEV governance SQL/application acknowledgement is required separately");
  if (ack.status !== "verified" || ack.production_host !== "https://app.reconiq.example") throw new Error("Parent release acknowledgement must be verified for the canonical production host");
  if (!String(ack.previous_production_deployment ?? "").startsWith(cosmeticDeployments.PROD)) throw new Error("Release acknowledgement must chain from the current cosmetic PROD baseline");
  if (!expectedMigrations.every(version => (ack.applied_migrations ?? []).includes(version))) throw new Error("Parent acknowledgement must verify both exact governance migrations inside the combined packet");
  for (const environment of ["PROD", "DEV"]) if (ack.supplemental_catalog_sha256?.[environment] !== expectedSupplementHashes[environment]) throw new Error("Parent acknowledgement must bind both owner-supplied current supplemental catalog hashes");
  const current = await currentSourceHashes();
  for (const relative of sourceFiles) if (ack.source_sha256?.[relative] !== current[relative]) throw new Error(`Release acknowledgement source hash does not match ${relative}`);
  return { ackPath, ack, sourceHashes: current };
}

export async function verifySupplementalCatalogs() {
  const catalogs = {};
  for (const environment of ["PROD", "DEV"]) {
    const file = path.join(privateRoot, `FVI-GOVERNANCE-CATALOG-${environment}-SUPPLEMENT-20261002.json`);
    const bytes = await readFile(file);
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (hash !== expectedSupplementHashes[environment]) throw new Error(`${environment} supplemental governance catalog hash mismatch`);
    const capture = JSON.parse(bytes.toString("utf8"));
    const catalog = capture.rows?.[0]?.catalog;
    const helperNames = (catalog?.helpers ?? []).map(helper => `${helper.schema}.${helper.name}`).sort();
    if (capture.read_only !== true || catalog?.columns?.length !== 148 || catalog?.helpers?.length !== 7 || catalog?.enums?.length !== 264) throw new Error(`${environment} supplemental catalog qualification shape mismatch`);
    if (JSON.stringify(helperNames) !== JSON.stringify([...expectedQualifiedHelpers].sort())) throw new Error(`${environment} actual helper definitions differ from the supplied qualified helper set`);
    catalogs[environment] = { sha256: hash, read_only: true, columns: catalog.columns.length, helper_definitions: helperNames, enum_labels: catalog.enums.length, engine: catalog.engine };
  }
  return catalogs;
}

function decodeJwt(token) {
  const [header, payload, signature] = token.split(".");
  if (!header || !payload || !signature) throw new Error("QA storage state does not contain a valid signed session token");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

export async function actorSession(actor, supabaseUrl, { allowExpired = false } = {}) {
  const state = JSON.parse(await readFile(actor.storage_state, "utf8"));
  const values = (state.origins ?? []).flatMap(origin => origin.localStorage ?? []).filter(item => /^sb-.+-auth-token$/u.test(item.name));
  for (const item of values) {
    try {
      const session = JSON.parse(item.value);
      const token = session.access_token ?? session.currentSession?.access_token;
      if (!token) continue;
      const claims = decodeJwt(token);
      const expectedIssuer = `${new URL(supabaseUrl).origin}/auth/v1`;
      if (claims.sub !== actor.user_id || claims.iss !== expectedIssuer) continue;
      if (claims.aal !== "aal2") throw new Error("QA actor session is not a real AAL2 session");
      const expired = !Number.isFinite(claims.exp) || claims.exp * 1000 <= Date.now();
      if (expired !== allowExpired) continue;
      if (!allowExpired && claims.exp * 1000 - Date.now() < 600000) throw new Error("QA session needs at least ten minutes of remaining life; sign in with real MFA to an owned isolated session");
      return { token, claims, expired };
    } catch (error) {
      if (error instanceof Error && /AAL2|ten minutes/u.test(error.message)) throw error;
    }
  }
  throw new Error(allowExpired ? "A genuinely expired QA session for this actor was not found" : "A current isolated QA session for the expected actor was not found");
}

export async function rpc(input, actor, name, args, options = {}) {
  const mutation = !["user_has_permission", "list_governance_membership_requests", "get_governance_membership_request", "list_governance_membership_options", "governance_access_review_list", "governance_access_review_get", "governance_access_review_options"].includes(name);
  if (mutation) await verifyReleaseAck(undefined, input.environment ?? "PROD");
  if (name === "list_governance_membership_requests" && !Object.hasOwn(args, "_own_only")) args = { ...args, _own_only: false };
  const session = options.session ?? await actorSession(actor, input.supabase_url);
  if (mutation) {
    const evidenceFile = requirePrivatePath(process.env.FVI_GOVERNANCE_EVIDENCE_FILE, "FVI_GOVERNANCE_EVIDENCE_FILE");
    const { appendFile } = await import("node:fs/promises");
    await appendFile(`${evidenceFile}.journal.jsonl`, `${safeSummary({ at: new Date().toISOString(), stage: "before_mutation", rpc: name, actor_user_id: actor.user_id, args }).replaceAll("\n", "")}\n`, "utf8");
  }
  const response = await fetch(`${input.supabase_url.replace(/\/$/u, "")}/rest/v1/rpc/${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { apikey: input.publishable_key, Authorization: `Bearer ${session.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  const body = await response.text();
  let data;
  try { data = body ? JSON.parse(body) : null; } catch { data = null; }
  if (!response.ok) {
    const error = new Error(`Hosted RPC ${name} returned HTTP ${response.status}`);
    error.status = response.status;
    error.code = data?.code ?? null;
    error.native_message = typeof data?.message === "string" && !/bearer|secret|password|eyJ/u.test(data.message) ? data.message.slice(0, 500) : "unavailable";
    throw error;
  }
  return { data, status: response.status };
}

async function expectDenied(run, allowedCodes, label) {
  try { await run(); } catch (error) {
    if (allowedCodes.includes(error.code) || allowedCodes.includes(error.status)) return { label, denied: true, code: error.code ?? null, status: error.status ?? null };
    throw new Error(`${label} failed with unexpected HTTP ${error.status ?? "unknown"} / ${error.code ?? "unknown"}: ${error.native_message ?? error.message ?? "unavailable"}`);
  }
  throw new Error(`${label} unexpectedly succeeded`);
}

function membershipArgs(input, requestId, version, decision, reason, requestKey) {
  return { _tenant_id: input.tenant_id, _request_id: requestId, _expected_version: version, _decision: decision, _reason: reason, _request_key: requestKey };
}

/** @param {Omit<import('../../src/lib/governance-membership.functions.ts').GovernanceMembershipDecisionInput, 'decision'>} data */
export function membershipWithdrawArgs(data) {
  return { _tenant_id: data.tenant_id, _request_id: data.request_id, _expected_version: data.expected_version, _reason: data.reason, _request_key: data.request_key };
}

export function assertExactReplay(original, replay, label) {
  if (JSON.stringify(original) !== JSON.stringify(replay)) throw new Error(`${label} replay differs from the original committed result`);
}

async function permission(input, actor, userId) {
  const result = await rpc(input, actor, "user_has_permission", {
    _user_id: userId, _tenant_id: input.tenant_id, _permission_id: input.permission_id, _bu_id: input.bu_id,
  });
  if (typeof result.data !== "boolean") throw new Error("Permission probe returned a non-boolean result");
  return result.data;
}

/** @param {import('../../src/lib/governance-membership.functions.ts').GovernanceMembershipEnvironment} environment */
export function membershipOptionArgs(input, kind, environment = input.membership_environment ?? "prod", page = 1, search = "") {
  return { _tenant_id: input.tenant_id, _kind: kind, _page: page, _page_size: 25, _search: search,
    _bu_id: kind === "bu" ? null : input.bu_id, _workspace_id: kind === "group" ? input.workspace_id : null, _environment: kind === "bu" ? null : environment };
}

/** @param {import('../../src/lib/governance-membership.functions.ts').GovernanceMembershipListInput} data */
export function membershipListArgs(data) {
  return { _tenant_id: data.tenant_id, _page: data.page ?? 1, _page_size: data.page_size ?? 25, _search: data.search ?? "", _status: data.status ?? null, _bu_id: data.bu_id ?? null, _environment: data.environment ?? null, _own_only: data.own_only ?? false };
}

/** @returns {Promise<import('../../src/lib/governance-membership.functions.ts').GovernanceMembershipOptions['rows']>} */
export async function membershipChoices(input, actor, kind) {
  const rows = [];
  for (let page = 1; page <= 40; page++) {
    const result = (await rpc(input, actor, "list_governance_membership_options", membershipOptionArgs(input, kind, input.membership_environment ?? "prod", page))).data;
    if (!Array.isArray(result?.rows) || result.page !== page || result.page_size !== 25) throw new Error(`Invalid authoritative ${kind} option page`);
    rows.push(...result.rows);
    if (!result.has_more) return rows;
  }
  throw new Error(`Narrow the QA ${kind} scope; options exceed the bounded 1,000-row window`);
}

/** @param {import('../../src/lib/governance-access-review.functions.ts').GovernanceAccessReviewOption['id']} subjectUserId */
export async function reviewChoices(input, actor, kind, subjectUserId = input.actors.requester.user_id) {
  const result = await rpc(input, actor, "governance_access_review_options", { _input: {
    tenant_id: input.tenant_id, kind, page: 1, page_size: 100, search: "", bu_id: input.bu_id,
    group_id: input.group_id, workspace_id: input.workspace_id, subject_user_id: subjectUserId,
  } });
  if (!Array.isArray(result.data?.rows)) throw new Error(`Invalid authoritative review ${kind} options`);
  return result.data.rows;
}

export async function assertResourceRead(input, allowed) {
  const session = await actorSession(input.actors.requester, input.supabase_url);
  const query = new URLSearchParams({ select: "id", id: `eq.${input.resource_probe.id}`, tenant_id: `eq.${input.tenant_id}`, limit: "1" });
  const response = await fetch(`${input.supabase_url.replace(/\/$/u, "")}/rest/v1/${input.resource_probe.table}?${query}`, { headers: { apikey: input.publishable_key, Authorization: `Bearer ${session.token}` }, redirect: "error" });
  const rows = response.ok ? await response.json() : null;
  if (!Array.isArray(rows) || (allowed ? rows.length !== 1 || rows[0].id !== input.resource_probe.id : rows.length !== 0)) throw new Error(`Actual requester RLS resource read did not ${allowed ? "allow" : "deny"} the exact QA target`);
}

export async function assertMembershipCount(input, expected) {
  const session = await actorSession(input.actors.checker, input.supabase_url);
  const query = new URLSearchParams({ select: "group_id,user_id", group_id: `eq.${input.group_id}`, user_id: `eq.${input.actors.requester.user_id}`, limit: "2" });
  const response = await fetch(`${input.supabase_url.replace(/\/$/u, "")}/rest/v1/tenant_group_members?${query}`, { headers: { apikey: input.publishable_key, Authorization: `Bearer ${session.token}` }, redirect: "error" });
  const rows = response.ok ? await response.json() : null;
  if (!Array.isArray(rows) || rows.length !== expected) throw new Error(`Current independent checker did not read the exact expected QA membership count ${expected}`);
}

export async function verifyLiveRoles(input) {
  const roles = {};
  for (const [key, expectedReview] of [["requester", false], ["maker", true], ["checker", true], ["observer", false]]) {
    const session = await actorSession(input.actors[key], input.supabase_url);
    const response = await fetch(`${input.supabase_url.replace(/\/$/u, "")}/auth/v1/user`, { headers: { apikey: input.publishable_key, Authorization: `Bearer ${session.token}` }, redirect: "error" });
    const user = response.ok ? await response.json() : null;
    if (user?.id !== input.actors[key].user_id) throw new Error(`Actual signed QA session validation failed for ${key}`);
    const result = await rpc(input, input.actors[key], "list_governance_membership_requests", { _tenant_id: input.tenant_id, _page: 1, _page_size: 1, _search: "", _status: null, _bu_id: input.bu_id, _environment: input.membership_environment ?? "prod" });
    if (result.data?.permissions?.can_review_queue !== expectedReview || (key === "requester" && result.data.permissions.can_submit !== true)) throw new Error(`Current runtime QA role is incorrect for ${key}`);
    roles[key] = { real_aal2_session: true, can_review_queue: expectedReview, can_submit: result.data.permissions.can_submit ?? null };
  }
  return roles;
}

export async function runHostedWorkflow(input) {
  const ack = await verifyReleaseAck(undefined, input.environment ?? "PROD");
  const catalogs = await verifySupplementalCatalogs();
  const [checker, lapsed] = await Promise.all([
    actorSession(input.actors.checker, input.supabase_url),
    actorSession(input.actors.lapsed, input.supabase_url, { allowExpired: true }),
  ]);
  if (input.actors.requester.user_id === input.actors.checker.user_id || input.actors.requester.user_id === input.actors.maker.user_id) throw new Error("Requester must be a separate QA identity from both tenant administrators");
  if (input.actors.maker.user_id === input.actors.checker.user_id) throw new Error("Maker and checker must be distinct QA identities");

  const evidence = { run_id: randomUUID(), started_at: new Date().toISOString(), environment: input.environment ?? "PROD", target_application: input.app_origin, target_deployment_id: input.environment === "DEV" ? ack.ack.dev_deployment_id : ack.ack.production_deployment_id, production_deployment_id: ack.ack.production_deployment_id,
    source_sha256: ack.sourceHashes, supplemental_catalogs: catalogs, actors: Object.fromEntries(["requester", "maker", "checker", "observer", "lapsed"].map(key => [key, input.actors[key].user_id])),
    negative_cases: [], milestones: [] };
  evidence.runtime_roles = await verifyLiveRoles(input);
  for (const [kind, matches] of [["bu", row => row.id === input.bu_id], ["workspace", row => row.id === input.workspace_id], ["group", row => row.id === input.group_id && row.selectable !== false && row.requested_rights?.length > 0 && !!row.scope_label], ["environment", row => row.environment === (input.membership_environment ?? "prod")]]) {
    const choices = await membershipChoices(input, input.actors.requester, kind);
    if (!choices.some(matches)) throw new Error(`QA requester has no current eligible named ${kind} option`);
  }
  await assertResourceRead(input, false);
  await assertMembershipCount(input, 0);
  const initialPermission = await permission(input, input.actors.requester, input.actors.requester.user_id);
  if (initialPermission) throw new Error("QA requester already has the target group permission; choose an ungranted bounded QA permission");

  evidence.negative_cases.push(await expectDenied(() => rpc(input, input.actors.lapsed, "list_governance_membership_requests", {
    _tenant_id: input.tenant_id, _page: 1, _page_size: 1, _search: "", _status: null, _bu_id: null, _environment: null,
  }, { session: lapsed }), [401, 403], "expired AAL2 session"));
  evidence.negative_cases.push(await expectDenied(() => rpc(input, input.actors.requester, "list_governance_membership_requests", {
    _tenant_id: randomUUID(), _page: 1, _page_size: 1, _search: "", _status: null, _bu_id: null, _environment: null,
  }), ["42501"], "wrong tenant"));

  const withdrawalSubmitArgs = { _tenant_id: input.tenant_id, _bu_id: input.bu_id, _workspace_id: input.workspace_id, _group_id: input.group_id,
    _environment: input.membership_environment ?? "prod", _reason: "Bounded hosted QA withdrawal request", _request_key: randomUUID() };
  const withdrawalRequest = (await rpc(input, input.actors.requester, "submit_governance_membership_request", withdrawalSubmitArgs)).data;
  if (!withdrawalRequest?.id || withdrawalRequest.status !== "pending") throw new Error("Withdrawal control request did not enter the pending state");
  assertExactReplay(withdrawalRequest, (await rpc(input, input.actors.requester, "submit_governance_membership_request", withdrawalSubmitArgs)).data, "Request submission");
  const withdrawalArgs = membershipWithdrawArgs({ tenant_id: input.tenant_id, request_id: withdrawalRequest.id, expected_version: withdrawalRequest.version, reason: "Requester withdrew bounded QA request", request_key: randomUUID() });
  evidence.negative_cases.push(await expectDenied(() => rpc(input, input.actors.checker, "withdraw_governance_membership_request", { ...withdrawalArgs, _request_key: randomUUID() }), ["42501"], "non-requester withdrawal"));
  evidence.negative_cases.push(await expectDenied(() => rpc(input, input.actors.requester, "withdraw_governance_membership_request", { ...withdrawalArgs, _expected_version: withdrawalRequest.version + 1, _request_key: randomUUID() }), ["40001"], "stale withdrawal version"));
  const withdrawn = (await rpc(input, input.actors.requester, "withdraw_governance_membership_request", withdrawalArgs)).data;
  if (withdrawn.status !== "withdrawn" || withdrawn.version !== withdrawalRequest.version + 1 || withdrawn.outcome !== "no_access_granted") throw new Error("Requester withdrawal did not commit a closed no-grant outcome");
  assertExactReplay(withdrawn, (await rpc(input, input.actors.requester, "withdraw_governance_membership_request", withdrawalArgs)).data, "Requester withdrawal");
  evidence.negative_cases.push(await expectDenied(() => rpc(input, input.actors.requester, "withdraw_governance_membership_request", { ...withdrawalArgs, _reason: "Changed-payload withdrawal collision" }), ["23505"], "withdrawal request-key collision"));
  evidence.negative_cases.push(await expectDenied(() => rpc(input, input.actors.checker, "decide_governance_membership_request", membershipArgs(input, withdrawn.id, withdrawn.version, "approve", "Closed withdrawal cannot approve", randomUUID())), ["40001"], "approval of withdrawn request"));
  const withdrawalReadback = (await rpc(input, input.actors.requester, "get_governance_membership_request", { _tenant_id: input.tenant_id, _request_id: withdrawn.id })).data;
  if (withdrawalReadback.status !== "withdrawn" || withdrawalReadback.version !== withdrawn.version || withdrawalReadback.membership_active !== false) throw new Error("Persisted withdrawal readback differs or granted a membership");
  await assertMembershipCount(input, 0); await assertResourceRead(input, false);
  evidence.request_withdrawal = { request_id: withdrawn.id, version: withdrawn.version, audit_id: withdrawn.audit_id, correlation_id: withdrawn.correlation_id, request_replay_identical: true, withdrawal_replay_identical: true, persisted_status: withdrawalReadback.status, membership_count: 0 };

  const submitted = await rpc(input, input.actors.requester, "submit_governance_membership_request", {
    _tenant_id: input.tenant_id, _bu_id: input.bu_id, _workspace_id: input.workspace_id, _group_id: input.group_id,
    _environment: input.membership_environment ?? "prod", _reason: "Bounded hosted governance QA: requester access review", _request_key: randomUUID(),
  });
  const request = submitted.data;
  if (!request?.id || request.status !== "pending" || request.version !== 1 || request.outcome !== "pending") throw new Error("Hosted requester RPC did not return the expected pending request contract");
  evidence.membership_request = { id: request.id, version: request.version, correlation_id: request.correlation_id, audit_id: request.audit_id };
  const ownRequests = (await rpc(input, input.actors.requester, "list_governance_membership_requests", membershipListArgs({ tenant_id: input.tenant_id, page: 1, page_size: 100, own_only: true }))).data;
  if (!ownRequests?.rows?.some(row => row.id === request.id) || ownRequests.rows.some(row => row.requested_by !== input.actors.requester.user_id)) throw new Error("Actual requester own_only read includes another caller or omits its submitted request");
  evidence.milestones.push("ordinary requester created one scoped pending request");

  evidence.negative_cases.push(await expectDenied(() => rpc(input, input.actors.requester, "decide_governance_membership_request",
    membershipArgs(input, request.id, request.version, "approve", "Self-approval negative control", randomUUID())), ["42501"], "self approval"));
  evidence.negative_cases.push(await expectDenied(() => rpc(input, input.actors.observer, "decide_governance_membership_request",
    membershipArgs(input, request.id, request.version, "approve", "Non-admin negative control", randomUUID())), ["42501"], "non-admin approval"));

  const approvalKey = randomUUID();
  const approvalArgs = membershipArgs(input, request.id, request.version, "approve", "Independent bounded QA approval", approvalKey);
  const approval = (await rpc(input, input.actors.checker, "decide_governance_membership_request", approvalArgs)).data;
  const replay = (await rpc(input, input.actors.checker, "decide_governance_membership_request", approvalArgs)).data;
  if (JSON.stringify(approval) !== JSON.stringify(replay) || approval?.outcome !== "grant_confirmed" || approval.status !== "approved") throw new Error("Approval replay did not return the exact original committed result");
  evidence.membership_approval = { id: approval.id, version: approval.version, correlation_id: approval.correlation_id, audit_id: approval.audit_id, replay_same_result: true };
  evidence.negative_cases.push(await expectDenied(() => rpc(input, input.actors.checker, "decide_governance_membership_request", { ...approvalArgs, _reason: "Changed approval payload" }), ["23505"], "approval request-key collision"));
  evidence.negative_cases.push(await expectDenied(() => rpc(input, input.actors.maker, "decide_governance_membership_request", approvalArgs), ["23505"], "cross-actor approval-key reuse"));
  if (!(await permission(input, input.actors.requester, input.actors.requester.user_id))) throw new Error("Approved QA membership did not enable the exact configured target permission");
  await assertResourceRead(input, true);
  await assertMembershipCount(input, 1);
  evidence.milestones.push("independent checker approval and same-key replay confirmed");

  const campaignInput = (label, key) => ({ tenant_id: input.tenant_id, name: label, description: "Bounded governance hosted QA; synthetic QA identity only", due_at: new Date(Date.now() + 86_400_000).toISOString(), request_key: key,
    memberships: [{ subject_user_id: input.actors.requester.user_id, group_id: input.group_id, reviewer_id: input.actors.checker.user_id, workspace_id: input.workspace_id }] });
  const reviewItem = async (label) => {
    const members = await reviewChoices(input, input.actors.maker, "members");
    const member = members.find(row => row.subject_user_id === input.actors.requester.user_id && row.group_id === input.group_id);
    const reviewers = await reviewChoices(input, input.actors.maker, "reviewers");
    if (!member?.snapshot_hash || !reviewers.some(row => row.id === input.actors.checker.user_id)) throw new Error("First campaign setup lacks a current named membership snapshot or independent reviewer");
    const requestKey = randomUUID();
    const payload = campaignInput(label, requestKey);
    payload.memberships[0].snapshot_hash = member.snapshot_hash;
    const campaign = (await rpc(input, input.actors.maker, "governance_access_review_campaign_create", { _input: payload })).data;
    if (!campaign?.campaign_id || campaign.item_ids?.length !== 1) throw new Error("Access-review campaign did not return exactly one actual review item");
    const replay = (await rpc(input, input.actors.maker, "governance_access_review_campaign_create", { _input: payload })).data;
    if (JSON.stringify(campaign) !== JSON.stringify(replay)) throw new Error("Access-review first-setup same-key replay did not return the original campaign and item IDs");
    const detail = (await rpc(input, input.actors.checker, "governance_access_review_get", { _input: { tenant_id: input.tenant_id, id: campaign.item_ids[0] } })).data;
    if (!detail?.snapshot_hash || detail.snapshot_current !== true || detail.outcome !== "pending" || detail.version < 1) throw new Error("Access-review item lacks a current authoritative snapshot");
    return { campaign, detail };
  };
  const retain = await reviewItem(`Hosted QA retain ${evidence.run_id.slice(0, 8)}`);
  evidence.negative_cases.push(await expectDenied(() => rpc(input, input.actors.maker, "governance_access_review_decide", { _input: {
    tenant_id: input.tenant_id, id: retain.detail.id, expected_version: retain.detail.version, snapshot_hash: retain.detail.snapshot_hash, decision: "retain", reason: "Campaign creator cannot be its independent reviewer", request_key: randomUUID(),
  } }), ["42501"], "campaign creator decision denial"));
  evidence.negative_cases.push(await expectDenied(() => rpc(input, input.actors.checker, "governance_access_review_decide", { _input: {
    tenant_id: input.tenant_id, id: retain.detail.id, expected_version: retain.detail.version + 1, snapshot_hash: retain.detail.snapshot_hash,
    decision: "retain", reason: "Changed-version negative control", request_key: randomUUID(),
  } }), ["40001"], "stale access-review version"));
  const retained = (await rpc(input, input.actors.checker, "governance_access_review_decide", { _input: {
    tenant_id: input.tenant_id, id: retain.detail.id, expected_version: retain.detail.version, snapshot_hash: retain.detail.snapshot_hash,
    decision: "retain", reason: "Independent current-snapshot retention", request_key: randomUUID(),
  } })).data;
  if (retained?.outcome !== "retained" || retained.version !== retain.detail.version + 1) throw new Error("Current-snapshot retention did not commit with the next version");
  evidence.review_retention = { campaign_id: retain.campaign.campaign_id, id: retained.id, version: retained.version, correlation_id: retained.correlation_id };

  const revoke = await reviewItem(`Hosted QA revoke ${evidence.run_id.slice(0, 8)}`);
  const revokeArgs = { _input: {
    tenant_id: input.tenant_id, id: revoke.detail.id, expected_version: revoke.detail.version, snapshot_hash: revoke.detail.snapshot_hash,
    decision: "revoke", reason: "Bounded QA group revocation verification", request_key: randomUUID(),
  } };
  const revoked = (await rpc(input, input.actors.checker, "governance_access_review_decide", revokeArgs)).data;
  if (revoked?.outcome !== "revoked" || revoked.membership_revoked !== true || revoked.snapshot_current !== false) throw new Error("Review did not report the exact membership revocation");
  if (await permission(input, input.actors.requester, input.actors.requester.user_id)) throw new Error("Target group permission remains allowed after the reviewed QA membership was revoked");
  await assertResourceRead(input, false);
  await assertMembershipCount(input, 0);
  assertExactReplay(revoked, (await rpc(input, input.actors.checker, "governance_access_review_decide", revokeArgs)).data, "Access-review revocation");
  const revokeReadback = (await rpc(input, input.actors.checker, "governance_access_review_get", { _input: { tenant_id: input.tenant_id, id: revoked.id } })).data;
  if (revokeReadback.outcome !== "revoked" || revokeReadback.version !== revoked.version || revokeReadback.snapshot_current !== false || revokeReadback.permitted_actions.length !== 0) throw new Error("Persisted closed revocation review differs from the committed result");
  evidence.review_revocation = { campaign_id: revoke.campaign.campaign_id, id: revoked.id, version: revoked.version, correlation_id: revoked.correlation_id, membership_revoked: true, target_permission_denied: true };
  evidence.milestones.push("retention, changed-version refusal, and actual group permission denial after review revocation confirmed");

  // A tenant-admin requester proves the independent-checker rule after passing the admin gate.
  const selfRequest = (await rpc(input, input.actors.maker, "submit_governance_membership_request", {
    _tenant_id: input.tenant_id, _bu_id: input.bu_id, _workspace_id: input.workspace_id, _group_id: input.group_id,
    _environment: input.membership_environment ?? "prod", _reason: "Bounded hosted QA: explicit self-approval denial control", _request_key: randomUUID(),
  })).data;
  if (!selfRequest?.id || selfRequest.status !== "pending") throw new Error("Self-approval control request did not enter the pending state");
  evidence.negative_cases.push(await expectDenied(() => rpc(input, input.actors.maker, "decide_governance_membership_request",
    membershipArgs(input, selfRequest.id, selfRequest.version, "approve", "Self-approval denial control", randomUUID())), ["42501"], "tenant-admin self approval"));
  const selfControlCleanup = (await rpc(input, input.actors.checker, "decide_governance_membership_request",
    membershipArgs(input, selfRequest.id, selfRequest.version, "reject", "Close bounded self-approval negative-control request", randomUUID()))).data;
  if (selfControlCleanup?.status !== "rejected" || selfControlCleanup?.outcome !== "no_access_granted") throw new Error("Independent checker did not close the self-approval negative-control request without granting access");
  evidence.self_approval_control = { request_id: selfRequest.id, denial_confirmed: true, closed_by_independent_checker: input.actors.checker.user_id, no_access_granted: true };

  const auditActions = ["governance.membership.request", "governance.membership.approve", "governance.membership.reject", "governance.membership.withdraw", "governance.access_review.campaign.create", "governance.access_review.retain", "governance.access_review.revoke"];
  const relevantIds = [request.id, withdrawn.id, selfRequest.id, retain.detail.id, revoke.detail.id, retain.campaign.campaign_id, revoke.campaign.campaign_id];
  const query = new URLSearchParams({
    select: "id,tenant_id,actor_user_id,occurred_at,scope,action,resource_type,resource_id,context",
    tenant_id: `eq.${input.tenant_id}`, action: `in.(${auditActions.join(",")})`,
    resource_id: `in.(${relevantIds.join(",")})`, occurred_at: `gte.${evidence.started_at}`,
    order: "occurred_at.asc,id.asc", limit: "1000",
  });
  const auditResponse = await fetch(`${input.supabase_url.replace(/\/$/u, "")}/rest/v1/audit_log?${query}`, {
    headers: { apikey: input.publishable_key, Authorization: `Bearer ${checker.token}` }, redirect: "error",
  });
  const auditRows = auditResponse.ok ? await auditResponse.json() : null;
  if (!Array.isArray(auditRows)) throw new Error("Tenant-authorized hosted audit read failed");
  const relevant = auditRows.filter(row => row.tenant_id === input.tenant_id && relevantIds.includes(row.resource_id));
  const requiredActions = auditActions;
  const auditSummary = relevant.map(row => ({ id: String(row.id), occurred_at: row.occurred_at, actor_user_id: row.actor_user_id,
    scope: row.scope, action: row.action, resource_id: row.resource_id,
    request_id: row.context?.request_id ?? null, review_id: row.context?.review_id ?? null,
    reason: typeof row.context?.reason === "string" ? row.context.reason : null,
    version: Number.isSafeInteger(row.context?.version) ? row.context.version : null,
    correlation_id: row.context?.correlation_id ?? null, outcome: row.context?.outcome ?? null }));
  for (const action of requiredActions) if (!auditSummary.some(row => row.action === action)) throw new Error(`Hosted audit trail is missing required event ${action}`);
  for (const [resourceId, action, actorId, reason, version] of [
    [withdrawn.id, "governance.membership.request", input.actors.requester.user_id, withdrawalSubmitArgs._reason, withdrawalRequest.version],
    [withdrawn.id, "governance.membership.withdraw", input.actors.requester.user_id, withdrawalArgs._reason, withdrawn.version],
    [request.id, "governance.membership.request", input.actors.requester.user_id, "Bounded hosted governance QA: requester access review", request.version],
    [request.id, "governance.membership.approve", input.actors.checker.user_id, approvalArgs._reason, approval.version],
    [selfRequest.id, "governance.membership.reject", input.actors.checker.user_id, "Close bounded self-approval negative-control request", selfControlCleanup.version],
    [retained.id, "governance.access_review.retain", input.actors.checker.user_id, "Independent current-snapshot retention", retained.version],
    [revoked.id, "governance.access_review.revoke", input.actors.checker.user_id, "Bounded QA group revocation verification", revoked.version],
  ]) {
    const rows = auditSummary.filter(row => row.resource_id === resourceId && row.action === action);
    if (rows.length !== 1 || rows[0].actor_user_id !== actorId || rows[0].reason !== reason || rows[0].version !== version) throw new Error(`Exact one-event actor/reason/version audit readback failed for ${action}`);
  }
  evidence.membership_cardinality = { before: 0, after_approval_and_replay: 1, after_revocation: 0 };
  if (auditSummary.some(row => !row.actor_user_id || !row.occurred_at || !row.correlation_id || row.version == null)) throw new Error("Hosted audit trail lacks a required actor, UTC timestamp, version or correlation field");
  if (auditSummary.some(row => row.action !== "governance.access_review.campaign.create" && !row.reason)) throw new Error("Hosted decision audit event lacks its recorded reason");
  evidence.audit_readback = auditSummary;
  evidence.milestones.push("tenant-authorized audit readback confirmed actor, event time, reason, version and correlation for actual hosted outcomes");
  evidence.completed_at = new Date().toISOString();
  return evidence;
}

async function main() {
  const mode = modeFromArgs(process.argv.slice(2));
  let input = null;
  try { input = await loadInputs(); } catch (error) {
    if (mode !== "preflight") throw error;
  }
  const status = { mode, writes_enabled: mode === "execute", production_host: "https://app.reconiq.example", baseline_prod_prefix: cosmeticDeployments.PROD, baseline_dev_prefix: cosmeticDeployments.DEV,
    inputs_ready: !!input, missing: [], release_ack_verified: false };
  status.supplemental_catalogs = await verifySupplementalCatalogs();
  if (process.env.FVI_GOVERNANCE_SESSION_READINESS_FILE) {
    const receiptPath = requirePrivatePath(process.env.FVI_GOVERNANCE_SESSION_READINESS_FILE, "FVI_GOVERNANCE_SESSION_READINESS_FILE");
    const readiness = JSON.parse(await readFile(receiptPath, "utf8"));
    const transport = JSON.parse(await readFile(path.join(privateRoot, "FVI-QA-TRANSPORT-PROD-20261001.json"), "utf8"));
    status.prepared_actors = [];
    for (const actor of readiness.actors.filter(actor => ["requester", "checker", "maker"].includes(actor.kind))) {
      await actorSession(actor, transport.apiUrl);
      status.prepared_actors.push({ kind: actor.kind, user_id: actor.user_id, current_role_at_readiness: actor.current_role, real_aal2: actor.real_aal2, expires_at: actor.expires_at });
    }
    status.prepared_session_count = status.prepared_actors.length;
    status.private_readiness_receipt = receiptPath;
  }
  if (!input) status.missing.push("private input file with exact tenant/BU/workspace/new QA group/permission and isolated actor states");
  if (mode !== "preflight") {
    const { ack } = await verifyReleaseAck(undefined, input.environment ?? "PROD");
    status.release_ack_verified = true;
    status.production_deployment_id = ack.production_deployment_id;
    if (mode === "execute") {
      const output = requirePrivatePath(process.env.FVI_GOVERNANCE_EVIDENCE_FILE, "FVI_GOVERNANCE_EVIDENCE_FILE");
      const { writeFile, mkdir } = await import("node:fs/promises");
      await mkdir(path.dirname(output), { recursive: true });
      await writeFile(`${output}.started.json`, safeSummary({ started_at: new Date().toISOString(), production_deployment_id: ack.production_deployment_id, status: "started; inspect journal and current committed state before any restart" }), { flag: "wx" });
      const result = await runHostedWorkflow(input);
      await writeFile(output, `${safeSummary(result)}\n`, { encoding: "utf8", flag: "wx" });
      status.evidence_file = output;
      status.workflow = "passed";
    }
  }
  process.stdout.write(`${safeSummary(status)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : "Hosted governance preflight failed"}\n`);
    process.exitCode = 1;
  });
}
