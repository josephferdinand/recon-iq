// Trusted Admin API creates one NEW synthetic actor; all subsequent checks use
// ordinary password/MFA and the existing tenant administrator's real session.
import { readFile, writeFile } from "node:fs/promises";
import { randomBytes, randomUUID, createHmac } from "node:crypto";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { actorSession } from "./governance-approval-hosted-20261002.mjs";
import { own, privateRoot, credential, releaseAck } from "./governance-approval-hosted-20261002.release-20261004.mjs";
await releaseAck();
const transport = JSON.parse(await readFile(path.join(privateRoot, "FVI-QA-TRANSPORT-DEV-20261002.json"), "utf8"));
if (transport.projectRef !== "YOUR_PROJECT_REF") throw new Error("DEV transport differs");
const ready = JSON.parse(await readFile(process.env.FVI_GOVERNANCE_SESSION_READINESS_FILE, "utf8"));
const maker = ready.actors.find(a => a.kind === "maker" && a.current_role === "tenant_admin" && a.real_aal2);
const { token: makerToken } = await actorSession(maker, transport.apiUrl);
if (!process.argv.includes("--execute")) { console.log(JSON.stringify({ mode: "read-only-preflight", environment: "DEV", real_mfa_maker: true, tenant_id: maker.tenant_id, actor_creation: false, execute_requires: "--execute and exact current paired release/session guards" })); process.exit(0); }
const file = path.join(own, "DEV-ANALYST-PROVISION-20261004.json");
let state;
try { state = JSON.parse(await readFile(file, "utf8")); }
catch (error) { if (error.code !== "ENOENT") throw error; const id = randomUUID(); state = { run_id: id, at: new Date().toISOString(), project_ref: transport.projectRef, tenant_id: maker.tenant_id, email: `codex.qa+zeno-dev-${id.slice(0,8)}@reconiq.example`, password: `${randomBytes(24).toString("base64url")}!Aa9`, stage: "prepared", events: [] }; await writeFile(file, JSON.stringify(state), { flag: "wx", mode: 0o600 }); }
if (state.project_ref !== transport.projectRef || state.tenant_id !== maker.tenant_id) throw new Error("Retained new actor realm differs");
const save = () => writeFile(file, JSON.stringify(state, null, 2));
const event = async (operation, stage, result = {}) => { state.events.push({ operation, stage, at: new Date().toISOString(), ...result }); await save(); };
const headers = token => ({ apikey: transport.anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" });
async function auth(endpoint, body, token) {
  const response = await fetch(`${transport.apiUrl}/auth/v1/${endpoint}`, { method: "POST", headers: { apikey: transport.anonKey, "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  const data = await response.json(); await event(endpoint.split("?")[0], "response", { http: response.status, code: response.ok ? null : data.code ?? data.error_code ?? "unknown" });
  if (!response.ok) throw new Error(`Owned Auth operation refused HTTP${response.status}`);
  return data;
}
function totp(secret) {
  let bits = ""; for (const c of secret.toUpperCase().replaceAll("=", "")) { const n = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(c); if (n < 0) throw new Error("Owned TOTP seed invalid"); bits += n.toString(2).padStart(5,"0"); }
  const bytes = []; for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i,i+8),2));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
  const digest = createHmac("sha1", Buffer.from(bytes)).update(counter).digest(); return String((digest.readUInt32BE(digest[digest.length-1]&15)&0x7fffffff)%1000000).padStart(6,"0");
}
try {
  if (!state.user_id) {
    if (state.stage === "before_create_user") throw new Error("Uncertain prior Admin creation: inspect exact owned email before retry; no duplicate create or reset");
    const service = await credential("SUPABASE_DEV_SERVICE_ROLE_KEY");
    if (!service.startsWith("sb_secret_")) { const claims = JSON.parse(Buffer.from(service.split(".")[1],"base64url")); if (claims.role !== "service_role" || claims.ref !== transport.projectRef) throw new Error("Protected DEV Admin credential realm differs"); }
    state.stage = "before_create_user"; await event("admin.createUser", "before");
    const admin = createClient(transport.apiUrl, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const result = await admin.auth.admin.createUser({ email: state.email, password: state.password, email_confirm: true, user_metadata: { full_name: "Zeno DEV Governance Analyst — Synthetic QA", synthetic_test_identity: true, purpose: "owned_governance_hosted_qa", environment: "dev", qa_run_id: state.run_id } });
    if (result.error || !result.data.user) { await event("admin.createUser", "refused", { status: result.error?.status ?? null, code: result.error?.code ?? "unknown" }); throw new Error("Trusted DEV Admin creation refused; no account changed or deleted"); }
    state.user_id = result.data.user.id; state.stage = "new_user_created"; await event("admin.createUser", "committed", { user_id: state.user_id });
  }
  const signed = await auth("token?grant_type=password", { email: state.email, password: state.password });
  if (signed.user?.id !== state.user_id) throw new Error("New owned normal sign-in identity differs");
  if (!state.factor_id) {
    if ((signed.user.factors ?? []).some(f => f.status === "verified")) throw new Error("Verified factor lacks retained seed; no factor removal/reset");
    const enrolled = await auth("factors", { factor_type: "totp", friendly_name: "Zeno owned DEV governance analyst" }, signed.access_token);
    state.factor_id = enrolled.id; state.totp_secret = enrolled.totp?.secret; await save();
  }
  const challenge = await auth(`factors/${state.factor_id}/challenge`, {}, signed.access_token);
  const verified = await auth(`factors/${state.factor_id}/verify`, { challenge_id: challenge.id, code: totp(state.totp_secret) }, signed.access_token);
  const claims = JSON.parse(Buffer.from(verified.access_token.split(".")[1], "base64url"));
  if (claims.sub !== state.user_id || claims.aal !== "aal2" || claims.iss !== `${transport.apiUrl}/auth/v1`) throw new Error("Genuine new actor assurance/issuer differs");
  const query = new URLSearchParams({ select: "user_id,tenant_id,role,active", tenant_id: `eq.${state.tenant_id}`, user_id: `eq.${state.user_id}` });
  const existingResponse = await fetch(`${transport.apiUrl}/rest/v1/tenant_members?${query}`, { headers: headers(makerToken), signal: AbortSignal.timeout(15000) });
  const existing = await existingResponse.json(); if (!existingResponse.ok || !Array.isArray(existing)) throw new Error("Native membership read refused");
  if (existing.length === 0) {
    await event("tenant_members", "before", { role: "tenant_analyst", user_id: state.user_id });
    const response = await fetch(`${transport.apiUrl}/rest/v1/tenant_members`, { method: "POST", headers: { ...headers(makerToken), Prefer: "return=representation" }, body: JSON.stringify({ tenant_id: state.tenant_id, user_id: state.user_id, role: "tenant_analyst", active: true }), signal: AbortSignal.timeout(15000) });
    const data = await response.json(); await event("tenant_members", "response", { http: response.status, code: response.ok ? null : data.code ?? "unknown" }); if (!response.ok) throw new Error("Real tenant administrator's NEW analyst membership refused");
  } else if (existing.length !== 1 || existing[0].role !== "tenant_analyst" || !existing[0].active) throw new Error("Existing new actor membership differs; no forced role changes");
  const roleResponse = await fetch(`${transport.apiUrl}/rest/v1/tenant_members?${query}`, { headers: headers(verified.access_token), signal: AbortSignal.timeout(15000) });
  const roles = await roleResponse.json(); if (!roleResponse.ok || roles.length !== 1 || roles[0].role !== "tenant_analyst" || !roles[0].active) throw new Error("Actual ordinary analyst role readback differs");
  const stamp = new Date().toISOString().replaceAll(/[:.]/gu,"-");
  const stateFile = path.join(own, "actors", `requester-DEV-${stamp}.json`);
  await writeFile(stateFile, JSON.stringify({ cookies: [], origins: [{ origin: "https://dev.app.reconiq.example", localStorage: [{ name: `sb-${transport.projectRef}-auth-token`, value: JSON.stringify(verified) }] }] }), { flag: "wx", mode: 0o600 });
  state.stage = "ready"; state.status = "PASS"; state.real_aal2 = true; state.current_role = "tenant_analyst"; state.storage_state = stateFile; state.expires_at = new Date(claims.exp*1000).toISOString(); await save();
  const actor = { kind: "requester", user_id: state.user_id, tenant_id: state.tenant_id, current_role: state.current_role, active: true, real_aal2: true, storage_state: stateFile, expires_at: state.expires_at };
  const receipt = path.join(own, `DEV-THREE-ACTOR-READINESS-${stamp}.json`); await writeFile(receipt, JSON.stringify({ at: new Date().toISOString(), target: "https://dev.app.reconiq.example", actors: [...ready.actors, actor], provisioning_receipt: file }, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: state.status, user_id: state.user_id, current_role: state.current_role, real_aal2: true, receipt, provisioning_receipt: file, existing_accounts_changed: false }));
} catch (error) { state.status = "FAIL"; state.failure = { message: error.message }; await save(); console.log(JSON.stringify({ status: "FAIL", stage: state.stage, failure: error.message, provisioning_receipt: file, user_id: state.user_id ?? null })); process.exitCode = 1; }
