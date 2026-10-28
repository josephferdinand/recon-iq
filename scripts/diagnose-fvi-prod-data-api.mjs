import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const project = "YOUR_PROJECT_REF";
const vaultPath = process.env.FVI_VAULT_PATH ?? "";
const qaPath = process.env.FVI_QA_CREDENTIAL_FILE ?? "";
if (!path.isAbsolute(vaultPath) || path.basename(vaultPath) !== "Falcon-Veritas-Keys.md"
  || !path.isAbsolute(qaPath) || path.basename(qaPath) !== "FVI-Codex-QA-Assurance-Lab-PROD.md") {
  throw new Error("Set the canonical FVI vault and existing protected PROD QA credential file");
}
let stage = "read_protected_inputs";
async function main() {
  const vault = await readFile(vaultPath, "utf8");
  const qa = await readFile(qaPath, "utf8");
  const start = vault.indexOf("<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->");
  const end = vault.indexOf("<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->");
  if (start < 0 || end <= start) throw new Error("Canonical credential section unavailable");
  const rows = vault.slice(start, end).split(/\r?\n/u);
  const field = (name) => {
    const line = rows.find((row) => row.startsWith(`| \`${name}\` |`));
    const value = line?.split("|")[2]?.trim().replace(/^`|`$/gu, "");
    if (!value) throw new Error("Required protected input unavailable");
    return value;
  };
  const qaField = (name) => qa.split(/\r?\n/u).find((row) => row.startsWith(`- ${name}: `))
    ?.slice(name.length + 4).trim().replace(/^`|`$/gu, "");
  const email = qaField("Account");
  const password = qaField("Temporary password");
  if (!email || !password) throw new Error("QA inputs unavailable");
  const anon = field("SUPABASE_PROD_ANON_KEY");
  const management = field("SUPABASE_ACCESS_TOKEN");
  async function query(sql, readOnly) {
    const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
      method: "POST", headers: { authorization: `Bearer ${management}`, "content-type": "application/json" },
      body: JSON.stringify({ query: sql, read_only: readOnly }), signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error("Management query failed");
    return response.json();
  }

  stage = "clock_readback";
  const clocks = (await query("select clock_timestamp() as database_time, pg_is_in_recovery() as is_replica", true))[0];
  stage = "existing_qa_sign_in";
  const auth = await fetch(`https://${project}.supabase.co/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: anon, "content-type": "application/json" },
    body: JSON.stringify({ email, password }), signal: AbortSignal.timeout(20_000),
  });
  if (!auth.ok) throw new Error("QA authentication rejected");
  const session = await auth.json();
  if (!session.access_token) throw new Error("QA session unavailable");
  const claims = JSON.parse(Buffer.from(session.access_token.split(".")[1], "base64url").toString("utf8"));

  async function readProfile() {
    const response = await fetch(`https://${project}.supabase.co/rest/v1/profiles?select=id&limit=1`, {
      headers: { apikey: anon, authorization: `Bearer ${session.access_token}` },
      signal: AbortSignal.timeout(20_000),
    });
    const body = await response.json().catch(() => ({}));
    const message = typeof body.message === "string" ? body.message : "";
    return {
      status: response.status, server_date: response.headers.get("date"),
      code: /^PGRST\d{3}$/u.test(body.code ?? "") ? body.code : null,
      claim_failure: /issued at future/iu.test(message) ? "issued_at_future"
        : /expired/iu.test(message) ? "expired" : /signature/iu.test(message) ? "signature" : null,
      rows_visible: Array.isArray(body) ? body.length : null,
    };
  }
  stage = "before_reload_read";
  const before = await readProfile();
  let reloaded = false;
  let after = null;
  if (before.code === "PGRST303" && !clocks.is_replica && process.env.FVI_ALLOW_POSTGREST_RELOAD === "YES") {
    stage = "postgrest_reload_signal";
    // Supported runtime signal only; it changes no configuration values,
    // credentials, permissions or data. No project/database restart.
    await query("notify pgrst, 'reload config';", false);
    reloaded = true;
    await new Promise((resolve) => setTimeout(resolve, 2000));
    stage = "after_reload_read_same_jwt";
    after = await readProfile();
  }
  const evidence = {
    diagnostic_completed: true, target: "prod", at: new Date().toISOString(),
    auth_status: auth.status, auth_server_date: auth.headers.get("date"),
    jwt_issued_at: Number.isFinite(claims.iat) ? new Date(claims.iat * 1000).toISOString() : null,
    ...clocks, before, configuration_reload_signaled: reloaded, after,
    same_jwt_used: reloaded, data_api_recovered: (after ?? before).status === 200,
    credentials_changed: false,
  };
  await writeFile("_e2e_run/prod-data-api-reload-20260914.json", `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence));
}
await main().catch((error) => {
  console.error(JSON.stringify({ diagnostic_completed: false, stage, error_name: error?.name ?? "Error" }));
  process.exitCode = 1;
});
