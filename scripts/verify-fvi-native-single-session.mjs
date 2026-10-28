import { readFile } from "node:fs/promises";
import path from "node:path";

const targets = {
  dev: { ref: "YOUR_PROJECT_REF", publicKey: "SUPABASE_DEV_ANON_KEY", qaFile: "FVI-Codex-QA-Assurance-Lab-DEV.md" },
  prod: { ref: "YOUR_PROJECT_REF", publicKey: "SUPABASE_PROD_ANON_KEY", qaFile: "FVI-Codex-QA-Assurance-Lab-PROD.md" },
};
const targetName = process.env.FVI_SESSION_TEST_TARGET;
const target = targets[targetName];
if (process.env.FVI_ALLOW_SINGLE_SESSION_TEST !== "YES" || !target) {
  throw new Error("Set FVI_ALLOW_SINGLE_SESSION_TEST=YES and FVI_SESSION_TEST_TARGET=dev|prod");
}
const vaultPath = process.env.FVI_VAULT_PATH ?? "";
const qaPath = process.env.FVI_QA_CREDENTIAL_FILE ?? "";
if (!path.isAbsolute(vaultPath) || path.basename(vaultPath) !== "Falcon-Veritas-Keys.md" ||
    !path.isAbsolute(qaPath) || path.basename(qaPath) !== target.qaFile) {
  throw new Error("Use the canonical FVI vault and the matching isolated QA identity file");
}

const vault = await readFile(vaultPath, "utf8");
const start = vault.indexOf("<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->");
const end = vault.indexOf("<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->");
if (start < 0 || end <= start) throw new Error("Canonical FVI vault section unavailable");
const keyRow = vault.slice(start, end).split(/\r?\n/u)
  .find((line) => line.startsWith(`| \`${target.publicKey}\` |`));
const publicKey = keyRow?.split("|")[2]?.trim().replace(/^`|`$/gu, "");
const qaLines = (await readFile(qaPath, "utf8")).split(/\r?\n/u);
const qaField = (name) => qaLines.find((line) => line.startsWith(`- ${name}: `))
  ?.slice(name.length + 4).trim().replace(/^`|`$/gu, "");
const email = qaField("Account");
const password = qaField("Temporary password");
if (!publicKey || !email || !password) throw new Error("Protected QA inputs unavailable");

const endpoint = `https://${target.ref}.supabase.co/auth/v1/token`;
async function token(grantType, body) {
  const response = await fetch(`${endpoint}?grant_type=${grantType}`, {
    method: "POST",
    headers: { apikey: publicKey, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  return { status: response.status, data: response.ok ? await response.json() : null };
}
function sessionId(accessToken) {
  try {
    return JSON.parse(Buffer.from(accessToken.split(".")[1], "base64url").toString("utf8")).session_id;
  } catch {
    return null;
  }
}

const first = await token("password", { email, password });
if (first.status !== 200 || !first.data?.refresh_token) {
  console.log(JSON.stringify({ target: targetName, first_sign_in_http: first.status, test_complete: false }));
  process.exitCode = 1;
} else {
  const second = await token("password", { email, password });
  if (second.status !== 200 || !second.data?.refresh_token) {
    console.log(JSON.stringify({ target: targetName, first_sign_in_http: first.status,
      second_sign_in_http: second.status, test_complete: false }));
    process.exitCode = 1;
  } else {
    const distinctSessions = sessionId(first.data.access_token) !== sessionId(second.data.access_token);
    const older = await token("refresh_token", { refresh_token: first.data.refresh_token });
    const newer = await token("refresh_token", { refresh_token: second.data.refresh_token });
    const passed = distinctSessions && older.status !== 200 && newer.status === 200;
    console.log(JSON.stringify({ target: targetName, distinct_sessions: distinctSessions,
      older_refresh_http: older.status, newer_refresh_http: newer.status,
      test_complete: true, native_single_session_proven: passed }));
    if (!passed) process.exitCode = 1;
  }
}
