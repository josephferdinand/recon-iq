import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseCanonicalVault, TARGETS } from "./preflight-fvi-resource-identity-release.mjs";

const target = process.argv[2];
const projectRef = TARGETS[target];
if (!projectRef) throw new Error("Specify prod or dev");
const identities = {
  prod: { actor: "35c27858-e96d-48e3-8bad-1861826a33a7",
    tenant: "aa5ed999-69eb-41a0-a9c6-fbb439efcffb" },
  dev: { actor: "f60d3faf-5054-4438-8449-00d659024a3a",
    tenant: "aa5ed999-69eb-41a0-a9c6-fbb439efcffe" },
}[target];
const vaultPath = process.env.FVI_VAULT_PATH ?? "";
const credentialPath = process.env.FVI_QA_CREDENTIAL_FILE ?? "";
if (!path.isAbsolute(vaultPath) || path.basename(vaultPath) !== "Falcon-Veritas-Keys.md"
  || !path.isAbsolute(credentialPath)
  || path.basename(credentialPath) !== `FVI-QA-Access-${target.toUpperCase()}-maker-20260925.cred`) {
  throw new Error("Exact canonical vault and protected QA maker credential paths are required");
}
const vault = await readFile(vaultPath, "utf8");
parseCanonicalVault(vault);
const begin = vault.indexOf("<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->");
const end = vault.indexOf("<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->");
const row = vault.slice(begin, end).split(/\r?\n/u)
  .find((line) => line.startsWith(`| \`SUPABASE_${target.toUpperCase()}_ANON_KEY\` |`));
const key = row?.split("|")[2]?.trim().replace(/^`|`$/gu, "");
if (!key) throw new Error("Target public Auth key unavailable");
const protectedText = await readFile(credentialPath, "utf8");
const field = (label) => protectedText.match(new RegExp(`^\\s*(?:-\\s*)?${label}:\\s*(.+)$`, "mu"))?.[1]
  ?.trim().replace(/^`|`$/gu, "") ?? "";
const email = field("Account");
const password = field("Temporary password");
if (!email || !password) throw new Error("Protected QA maker credential incomplete");
const { createClient } = await import("@supabase/supabase-js");
const supabase = createClient(`https://${projectRef}.supabase.co`, key, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const health = await fetch(`https://${projectRef}.supabase.co/auth/v1/health`, {
  headers: { apikey: key }, signal: AbortSignal.timeout(15_000),
});
let actorMatched = false;
let restStatus = 0;
let restCode = "unavailable";
let tenantMatched = false;
try {
  const signedIn = await supabase.auth.signInWithPassword({ email, password });
  actorMatched = signedIn.data.user?.id === identities.actor;
  if (!signedIn.error && actorMatched) {
    const tenantRead = await supabase.from("tenants").select("id,slug")
      .eq("id", identities.tenant).maybeSingle();
    restStatus = tenantRead.status;
    restCode = tenantRead.error?.code ?? (tenantRead.error ? "error" : "ok");
    tenantMatched = tenantRead.data?.id === identities.tenant;
  } else {
    restCode = signedIn.error?.code ?? "actor_mismatch";
  }
} finally {
  await supabase.auth.signOut();
}
const ok = health.ok && actorMatched && restStatus === 200 && restCode === "ok" && tenantMatched;
console.log(JSON.stringify({ target, project_ref: projectRef, ok,
  auth_health_status: health.status, actor_matched: actorMatched,
  rest_status: restStatus, rest_code: restCode, tenant_matched: tenantMatched,
  credential_value_exposed: false }));
if (!ok) process.exitCode = 2;
