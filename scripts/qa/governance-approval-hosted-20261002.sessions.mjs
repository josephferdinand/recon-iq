// Fresh owned QA sign-ins only; secrets remain in process. No governance mutation.
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { createHmac } from "node:crypto";
import path from "node:path";
import { chromium } from "@playwright/test";

const root = path.join(process.env.LOCALAPPDATA, "FVI-QA-Private-20260925");
const output = path.join(root, "governance-approval-hosted-20261002", "actors");
const stamp = new Date().toISOString().replaceAll(/[:.]/gu, "-");
const transport = JSON.parse(await readFile(path.join(root, "FVI-QA-TRANSPORT-PROD-20261001.json"), "utf8"));
if (transport.projectRef !== "YOUR_PROJECT_REF" || new URL(transport.apiUrl).protocol !== "https:" || String(transport.anonKey).startsWith("sb_secret_")) throw new Error("Wrong QA public transport");
const seeds = JSON.parse(await readFile(path.join(root, "FVI-QA-FULL-PRODUCTION-ACTOR-SEEDS-20261001.json"), "utf8"));
const retained = JSON.parse(await readFile(path.join(root, "FVI-QA-MFA-RETURN-20261001T173519429Z-315c655d.json"), "utf8"));
const assignments = [{ kind: "requester", label: "kepler-scoped-observer", id: "86655159-7270-4635-a0f0-e3a627ad49fc", admin: false }, { kind: "checker", label: "volta-recon-dataprep", id: "72ebbe01-4ec7-403c-95b1-9a0482085cf2", admin: true }];
if (process.argv.includes("--requester-only")) assignments.splice(1);
if (process.argv.includes("--platform-checker-only")) {
  const platformSeeds = JSON.parse(await readFile(path.join(root, "FVI-QA-PLATFORM-ACTOR-SEEDS-20261001.json"), "utf8"));
  const platformMfa = JSON.parse(await readFile(path.join(root, "FVI-QA-MFA-RETURN-20261001T121545406Z-88ffda08.json"), "utf8"));
  seeds.actors.push(...platformSeeds.actors.filter(actor => actor.user_id === "9ed412a1-a48b-4988-842e-c14651a09126"));
  retained.actor_sessions.push(...platformMfa.actor_sessions.filter(actor => actor.user_id === "9ed412a1-a48b-4988-842e-c14651a09126"));
  assignments.splice(0, assignments.length, { kind: "directory_checker", label: "platform-checker", id: "9ed412a1-a48b-4988-842e-c14651a09126", admin: true });
}
if (process.argv.includes("--include-maker")) {
  const platformSeeds = JSON.parse(await readFile(path.join(root, "FVI-QA-PLATFORM-ACTOR-SEEDS-20261001.json"), "utf8"));
  const platformMfa = JSON.parse(await readFile(path.join(root, "FVI-QA-MFA-RETURN-20261001T121545406Z-88ffda08.json"), "utf8"));
  seeds.actors.push(...platformSeeds.actors.filter(actor => actor.user_id === "9d8ae600-cd90-46bc-bbb0-1da3aca3db57"));
  retained.actor_sessions.push(...platformMfa.actor_sessions.filter(actor => actor.user_id === "9d8ae600-cd90-46bc-bbb0-1da3aca3db57"));
  assignments.push({ kind: "maker", label: "platform-maker", id: "9d8ae600-cd90-46bc-bbb0-1da3aca3db57", admin: true });
}
async function authPost(endpoint, data, token, events) {
  const response = await fetch(`${transport.apiUrl}/auth/v1/${endpoint}`, { method: "POST", headers: { apikey: transport.anonKey, "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(data) });
  const result = await response.json();
  events.push({ endpoint: endpoint.split('?')[0], status: response.status, code: response.ok ? null : /^[a-z_]+$/u.test(result.code ?? result.error_code ?? "") ? result.code ?? result.error_code : "other" });
  if (!response.ok) throw new Error("Ordinary QA Auth operation refused");
  return result;
}
function totp(secret) {
  let bits = "";
  for (const char of secret.toUpperCase().replaceAll("=", "")) { const n = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(char); if (n < 0) throw new Error("Invalid protected TOTP seed"); bits += n.toString(2).padStart(5, "0"); }
  const bytes = []; for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac("sha1", Buffer.from(bytes)).update(counter).digest(); const offset = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, "0");
}
function sessionFromState(state, id) {
  for (const item of (state.origins ?? []).flatMap(origin => origin.localStorage ?? []).filter(item => /^sb-.+-auth-token$/u.test(item.name))) {
    const session = JSON.parse(item.value); const claims = JSON.parse(Buffer.from(session.access_token.split('.')[1], "base64url"));
    if (claims.sub === id) return { session, claims };
  }
  throw new Error("Actual browser QA session not found");
}
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const assignment of assignments) {
    let stage = "protected_inputs";
    const seed = seeds.actors.find(actor => actor.user_id === assignment.id && actor.label === assignment.label);
    const ref = retained.actor_sessions.find(actor => actor.user_id === assignment.id);
    if (!seed || !ref) throw new Error("Exact authorized QA seed/MFA mapping missing");
    const mfa = JSON.parse(await readFile(path.join(root, path.basename(ref.mfa_state_file)), "utf8"));
    if (mfa.user_id !== assignment.id || mfa.project_ref !== transport.projectRef || mfa.tenant_id !== seeds.tenant_id) throw new Error("QA MFA identity mismatch");
    const context = await browser.newContext();
    const page = await context.newPage();
    const authEvents = [];
    try {
      stage = "password_sign_in";
      if (process.argv.includes("--auth-api")) {
        const signedIn = await authPost("token?grant_type=password", { email: seed.email, password: seed.password }, null, authEvents);
        stage = "real_mfa_challenge";
        const challenge = await authPost(`factors/${mfa.factor_id}/challenge`, {}, signedIn.access_token, authEvents);
        const verified = await authPost(`factors/${mfa.factor_id}/verify`, { challenge_id: challenge.id, code: totp(mfa.totp_secret) }, signedIn.access_token, authEvents);
        if (!verified.access_token || verified.user?.id !== assignment.id) throw new Error("Ordinary real MFA verification did not return the expected QA identity");
        stage = "actual_application_session";
        await context.addInitScript(({ key, session }) => { localStorage.setItem(key, JSON.stringify(session)); }, { key: `sb-${transport.projectRef}-auth-token`, session: verified });
        await page.goto("https://app.reconiq.example/home", { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(1500);
        if (/\/(auth|mfa-challenge)(?:\/|$)/u.test(new URL(page.url()).pathname)) throw new Error("Actual application did not accept the real MFA session");
      } else {
      await page.goto("https://app.reconiq.example/auth", { waitUntil: "domcontentloaded" });
      stage = "email_control";
      await page.getByLabel("Email address").fill(seed.email);
      stage = "password_control";
      await page.getByLabel("Password", { exact: true }).fill(seed.password);
      stage = "submit_password";
      await page.locator('button[type="submit"]').click();
      stage = "mfa_route";
      await page.waitForURL(/\/mfa-challenge/u, { timeout: 30000 });
      stage = "real_mfa_challenge";
      await page.getByLabel("Six-digit code").fill(totp(mfa.totp_secret));
      await page.getByRole("button", { name: "Verify and continue", exact: true }).click();
      await page.waitForURL(url => !/\/(auth|mfa-challenge)(?:\/|$)/u.test(url.pathname), { timeout: 30000 });
      }
      stage = "actual_identity_current_role";
      const state = await context.storageState(); const { session, claims } = sessionFromState(state, assignment.id);
      if (claims.aal !== "aal2" || claims.exp * 1000 < Date.now() + 600000) throw new Error("Fresh browser state did not establish actual AAL2");
      const headers = { apikey: transport.anonKey, Authorization: `Bearer ${session.access_token}` };
      const userResponse = await fetch(`${transport.apiUrl}/auth/v1/user`, { headers });
      const user = userResponse.ok ? await userResponse.json() : null;
      if (user?.id !== assignment.id) throw new Error("Actual signed QA user validation failed");
      const query = new URLSearchParams({ select: "tenant_id,user_id,role,active", tenant_id: `eq.${seeds.tenant_id}`, user_id: `eq.${assignment.id}` });
      const roleResponse = await fetch(`${transport.apiUrl}/rest/v1/tenant_members?${query}`, { headers });
      const rows = roleResponse.ok ? await roleResponse.json() : null;
      const membership = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
      if (!membership?.active || (membership.role === "tenant_admin") !== assignment.admin) throw new Error("Actual current QA tenant role differs from its requested role");
      const statePath = path.join(output, `${assignment.kind}-PROD-${stamp}.json`);
      await writeFile(statePath, JSON.stringify(state), { flag: "wx" });
      let lapsedState = null;
      if (assignment.kind === "requester" && ref.browser_state_file) {
        const oldFile = path.join(root, path.basename(ref.browser_state_file));
        try {
          const oldState = JSON.parse(await readFile(oldFile, "utf8")); const old = sessionFromState(oldState, assignment.id);
          if (old.claims.aal === "aal2" && old.claims.exp * 1000 <= Date.now()) { lapsedState = path.join(output, `lapsed-PROD-${stamp}.json`); await copyFile(oldFile, lapsedState); }
        } catch { /* Missing old state is a precise later negative-test input, never fabricate a token. */ }
      }
      results.push({ kind: assignment.kind, user_id: assignment.id, tenant_id: seeds.tenant_id, current_role: membership.role, active: true, real_aal2: true, expires_at: new Date(claims.exp * 1000).toISOString(), storage_state: statePath, lapsed_state: lapsedState, existing_identity_preserved: true, auth_operations: authEvents });
    } catch {
      results.push({ kind: assignment.kind, status: "FAIL", stage, auth_operations: authEvents, route: new URL(page.url()).pathname });
      process.exitCode = 1;
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
const receipt = { at: new Date().toISOString(), target: "https://app.reconiq.example", scope: "Fresh ordinary QA sign-in and real MFA; current role reads only; no governance membership/review writes", actors: results };
const receiptPath = path.join(root, "governance-approval-hosted-20261002", `SESSION-READINESS-${stamp}.json`);
await writeFile(receiptPath, JSON.stringify(receipt, null, 2), { flag: "wx" });
process.stdout.write(`${JSON.stringify({ receipt: receiptPath, actors: results.map(({ kind, real_aal2, current_role, active, status, stage }) => ({ kind, real_aal2, current_role, active, status: status ?? "PASS", stage })) })}\n`);
