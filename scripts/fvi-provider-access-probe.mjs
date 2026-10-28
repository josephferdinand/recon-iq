// FVI provider access probe — read-only connectivity check for the receiving provider.
// Reads named fields from the owner-managed secured vault. NEVER prints, logs, or
// transmits any credential value. Emits field PRESENCE and HTTP status only.
//
// Usage: node scripts/fvi-provider-access-probe.mjs
// Requires: FVI_VAULT_PATH pointing at Falcon-Veritas-Keys.md (canonical block markers).

import { readFile } from "node:fs/promises";
import path from "node:path";

const vaultPath = process.env.FVI_VAULT_PATH;
if (!vaultPath || !path.isAbsolute(vaultPath) || path.basename(vaultPath) !== "Falcon-Veritas-Keys.md") {
  console.error("BLOCKED: set FVI_VAULT_PATH to the canonical secured vault.");
  process.exit(2);
}

const text = await readFile(vaultPath, "utf8");
const begin = text.indexOf("FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN");
const end = text.indexOf("FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END");
if (begin < 0 || end < 0) {
  console.error("BLOCKED: canonical credential markers not found.");
  process.exit(2);
}
const canonical = text.slice(begin, end);

const allText = text;
function tableField(scope, name) {
  const rows = scope.split(/\r?\n/u).filter((l) => l.startsWith("|"));
  const hits = rows.filter((l) => l.split("|")[1].trim().replace(/^[`*]+|[`*]+$/gu, "") === name);
  if (hits.length !== 1) return { present: false, value: null, rows: hits.length };
  const v = hits[0].split("|")[2].trim().replace(/^`|`$/gu, "").replace(/^<|>$/gu, "");
  return { present: v.length > 0, value: v };
}
const getCanonical = (n) => tableField(canonical, n);
const getAnywhere = (n) => tableField(allText, n);

// ---- presence inventory (names only) ----
const NAMES = [
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_PROD_ANON_KEY",
  "SUPABASE_PROD_SERVICE_ROLE_KEY",
  "SUPABASE_DEV_ANON_KEY",
  "SUPABASE_DEV_SERVICE_ROLE_KEY",
  "SUPABASE_SEND_EMAIL_HOOK_SECRET",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_ZONE_ID_FVI",
  "ZEPTOMAIL_API_KEY",
  "GITHUB_TOKEN",
  "GITHUB_APP_ID",
];
console.log("=== VAULT FIELD PRESENCE (no values) ===");
const presence = {};
for (const n of NAMES) {
  const c = getCanonical(n);
  const a = getAnywhere(n);
  presence[n] = c.value || a.value;
  console.log(
    `${n.padEnd(34)} canonical=${c.present ? "yes" : "no "} anywhere=${a.present ? "yes" : "no "}` +
      (a.rows > 1 ? `  AMBIGUOUS(${a.rows} rows)` : ""),
  );
}

const results = [];
const probe = async (name, fn) => {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
  } catch (e) {
    results.push({ name, ok: false, detail: e.message });
  }
};

const F = (u, opts = {}) => fetch(u, { ...opts });
const J = async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) });

// ---- 1. CLOUDFLARE ----
const cfTok = presence.CLOUDFLARE_API_TOKEN;
const cfAcc = presence.CLOUDFLARE_ACCOUNT_ID;
await probe("CLOUDFLARE", async () => {
  if (!cfTok) throw new Error("CLOUDFLARE_API_TOKEN not present in vault");
  const h = { Authorization: `Bearer ${cfTok}` };
  const v = await J(await F("https://api.cloudflare.com/client/v4/user/tokens/verify", { headers: h }));
  if (!v.body.success) throw new Error(`token verify failed status=${v.status}`);
  const me = await J(await F("https://api.cloudflare.com/client/v4/user", { headers: h }));
  const who = me.body.result?.email ?? "unknown";
  const acct = await J(await F(`https://api.cloudflare.com/client/v4/accounts/${cfAcc}`, { headers: h }));
  const acctOk = acct.body.success === true;
  const zones = await J(await F("https://api.cloudflare.com/client/v4/zones?name=reconiq.example", { headers: h }));
  const zoneId = zones.body.result?.[0]?.id ?? null;
  let pages = "skipped";
  if (acctOk) {
    const p = await J(await F(`https://api.cloudflare.com/client/v4/accounts/${cfAcc}/pages/projects/fvi-app`, { headers: h }));
    pages = p.body.success === true ? "fvi-app found" : `fvi-app NOT visible (${p.status})`;
  }
  return `token_status=valid identity=${who} account_resolves=${acctOk} zone_falconveritas=${zoneId ? "yes" : "no"} pages=${pages}`;
});

// ---- 2. SUPABASE MANAGEMENT + REST ----
const sbPat = presence.SUPABASE_ACCESS_TOKEN;
const prodAnon = presence.SUPABASE_PROD_ANON_KEY;
const devAnon = presence.SUPABASE_DEV_ANON_KEY;
await probe("SUPABASE_MANAGEMENT", async () => {
  if (!sbPat) throw new Error("SUPABASE_ACCESS_TOKEN not present in vault");
  const r = await J(await F("https://api.supabase.com/v1/projects?per_page=100", {
    headers: { Authorization: `Bearer ${sbPat}` },
  }));
  if (r.status !== 200) throw new Error(`management list status=${r.status}`);
  const refs = (r.body ?? []).map((p) => p.ref);
  const prod = "YOUR_PROJECT_REF";
  const dev = "YOUR_PROJECT_REF";
  const matched = [];
  for (const ref of [prod, dev]) {
    const hit = (r.body ?? []).find((p) => p.ref === ref);
    matched.push(
      `${ref}=${hit ? `${hit.name}/${hit.region ?? "?"}/plan:${hit.organization?.name ?? "?"}` : "NOT LISTED"}`,
    );
  }
  return `projects_visible=${refs.length} ${matched.join(" ")}`;
});

for (const [label, key, url] of [
  ["SUPABASE_PROD_REST", prodAnon, "https://YOUR_PROJECT_REF.supabase.co"],
  ["SUPABASE_DEV_REST", devAnon, "https://YOUR_PROJECT_REF.supabase.co"],
]) {
  await probe(label, async () => {
    if (!key) throw new Error("anon key not present in vault");
    const auth = await F(`${url}/auth/v1/health`, { headers: { apikey: key } });
    const rest = await F(`${url}/rest/v1/`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    return `auth_health=${auth.status} rest_root=${rest.status}`;
  });
}

// ---- 3. GITHUB ----
await probe("GITHUB_CLI", async () => {
  const { spawnSync } = await import("node:child_process");
  const verified = spawnSync(
    "pwsh",
    ["-NoProfile", "-File", "./.private", "-Project", "Veritas", "-Operation", "verify"],
    {
      encoding: "utf8", windowsHide: true, timeout: 60000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" },
    },
  );
  if (verified.status !== 0) throw new Error("Project-scoped GitHub verification did not complete; no interactive login requested.");
  return "Project-scoped route verified reconiq-brand/reconiq-intelligence; no global account switch.";
});

// ---- 4. ZEPTOMAIL ----
// The existing key is for sending, not domain administration. Zoho's domain
// listing requires OAuth with Zeptomail.Domains.READ; do not send this key to
// that endpoint or infer sender validity from its refusal. Never send test mail.
// https://www.zoho.com/cpaas/help/api/list-all-domains.html
results.push({
  name: "ZEPTOMAIL",
  ok: null,
  detail: presence.ZEPTOMAIL_API_KEY
    ? "UNTESTED: sender key recovered; read-only domain verification requires separate existing domain-read OAuth access. No email sent."
    : "UNTESTED: sender key not recovered; no provider request made.",
});

// ---- report ----
console.log("\n=== LIVE CONNECTIVITY PROBES ===");
for (const r of results) {
  console.log(`[${r.ok === null ? "UNTESTED" : r.ok ? "PASS" : "FAIL"}] ${r.name.padEnd(24)} ${r.detail}`);
}
const failed = results.filter((r) => r.ok === false);
const passed = results.filter((r) => r.ok === true);
const untested = results.filter((r) => r.ok === null);
console.log(`\nSUMMARY: ${passed.length} passed, ${failed.length} failed, ${untested.length} untested.`);
if (failed.length) console.log(`FAILED: ${failed.map((f) => f.name).join(", ")}`);
