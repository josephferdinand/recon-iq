import { createClient } from "@supabase/supabase-js";
import { createHmac } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

if (process.env.FVI_ALLOW_NATIVE_MFA_QA !== "YES") throw new Error("Set FVI_ALLOW_NATIVE_MFA_QA=YES");
const credentialPath = process.env.FVI_QA_CREDENTIAL_FILE ?? "";
const mfaPath = process.env.FVI_QA_MFA_VAULT_PATH ?? "";
const anonPath = process.env.FVI_PROD_ANON_KEY_FILE ?? "";
if (!path.isAbsolute(credentialPath) || path.basename(credentialPath) !== "FVI-Codex-QA-Assurance-Lab-PROD.md")
  throw new Error("QA credential path is invalid");
if (!path.isAbsolute(mfaPath) || path.basename(mfaPath) !== "FVI-Codex-QA-Native-MFA-PROD.md")
  throw new Error("QA MFA output path is invalid");
if (!path.isAbsolute(anonPath)) throw new Error("PROD publishable key path is invalid");

function field(markdown, name) {
  const prefix = `- ${name}: `;
  const line = markdown.split(/\r?\n/u).find((candidate) => candidate.startsWith(prefix));
  return line?.slice(prefix.length).trim().replace(/^`|`$/gu, "") ?? "";
}

function decodeBase32(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of value.toUpperCase().replace(/=+$/u, "")) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error("Invalid TOTP secret encoding");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  return Buffer.from(bytes);
}

function totp(secret, now = Date.now()) {
  const counter = Math.floor(now / 30_000);
  const value = Buffer.alloc(8);
  value.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secret)).update(value).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24) | ((digest[offset + 1] & 0xff) << 16) | ((digest[offset + 2] & 0xff) << 8) | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

const credentialMarkdown = await readFile(credentialPath, "utf8");
const email = field(credentialMarkdown, "Account");
const password = field(credentialMarkdown, "Temporary password");
if (!email || !password) throw new Error("QA credential file is incomplete");
const anon = (await readFile(anonPath, "utf8")).trim();
const client = createClient("https://YOUR_PROJECT_REF.supabase.co", anon, { auth: { persistSession: false, autoRefreshToken: false } });
const signedIn = await client.auth.signInWithPassword({ email, password });
if (signedIn.error || !signedIn.data.user) throw new Error("QA sign-in failed");
const factors = await client.auth.mfa.listFactors();
if (factors.error) throw new Error("QA factor lookup failed");
const existing = (factors.data?.all ?? []).filter((factor) => factor.status === "verified");

let factorId = "";
let secret = "";
let reused = false;
if (existing.length > 0) {
  let saved = "";
  try { saved = await readFile(mfaPath, "utf8"); } catch { /* first managed run */ }
  factorId = field(saved, "Factor ID");
  secret = field(saved, "TOTP secret");
  if (!factorId || !secret || !existing.some((factor) => factor.id === factorId))
    throw new Error("QA has an existing native factor without matching secured-vault state; refusing replacement");
  const verified = await client.auth.mfa.challengeAndVerify({ factorId, code: totp(secret) });
  if (verified.error) throw new Error("Stored QA native MFA factor could not be verified");
  reused = true;
} else {
  const enrolled = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: "FVI PROD browser assurance" });
  if (enrolled.error) throw new Error("QA native MFA enrollment failed");
  factorId = enrolled.data.id;
  secret = enrolled.data.totp.secret;
  const verified = await client.auth.mfa.challengeAndVerify({ factorId, code: totp(secret) });
  if (verified.error) throw new Error("QA native MFA verification failed");
  await writeFile(mfaPath, [
    "# ReconIQ — Codex QA Native MFA",
    "",
    "- Environment: PROD synthetic assurance identity only",
    `- Account: \`${email}\``,
    `- Factor ID: \`${factorId}\``,
    `- TOTP secret: \`${secret}\``,
    "- Purpose: retained browser AAL2 and password-change assurance",
    "",
    "> Never copy this secret into Git, logs, Graphify, Obsidian, or chat.",
    "> Do not rotate, remove, or replace it without owner approval.",
    "",
  ].join("\n"), { encoding: "utf8", mode: 0o600 });
  await chmod(mfaPath, 0o600).catch(() => undefined);
}

const assurance = await client.auth.mfa.getAuthenticatorAssuranceLevel();
if (assurance.error || assurance.data.currentLevel !== "aal2" || assurance.data.nextLevel !== "aal2")
  throw new Error("QA session did not reach AAL2");
await client.auth.signOut();
console.log(JSON.stringify({ ok: true, user_id: signedIn.data.user.id, factor_id: factorId, factor_reused: reused, verified_factor_count: Math.max(1, existing.length), current_level: assurance.data.currentLevel, next_level: assurance.data.nextLevel, secret_saved: true }));
