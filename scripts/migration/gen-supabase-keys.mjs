#!/usr/bin/env node
/**
 * Generate self-hosted Supabase ANON_KEY and SERVICE_ROLE_KEY.
 *
 * The signing secret is read from the SUPABASE_JWT_SECRET environment
 * variable (never from argv, so it cannot leak via process lists or shell
 * history). Generated keys are written to a gitignored output file with
 * mode 0600; the console receives key names, lengths and expiry only.
 *
 * Usage:
 *   SUPABASE_JWT_SECRET="..." node scripts/migration/gen-supabase-keys.mjs [years] [outFile]
 *
 * Produces two HS256 JWTs matching the managed-Supabase claim contract so the
 * application's existing key handling continues to work unchanged.
 */

import { createHmac } from "node:crypto";
import { writeFileSync } from "node:fs";

const secret = process.env.SUPABASE_JWT_SECRET;
const years = Number(process.argv[2] ?? 10);
const outFile = process.argv[3] ?? ".env.generated.local";

if (!secret || secret.length < 32) {
  console.error(
    "SUPABASE_JWT_SECRET env var (>=32 chars) is required. Do not pass the secret as an argument.",
  );
  process.exit(1);
}

const b64url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function sign(payload) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const sig = b64url(createHmac("sha256", secret).update(data).digest());
  return `${data}.${sig}`;
}

const iat = Math.floor(Date.now() / 1000);
const exp = iat + Math.round(years * 365.25 * 24 * 60 * 60);

const anonKey = sign({ role: "anon", iss: "supabase", iat, exp });
const serviceRoleKey = sign({ role: "service_role", iss: "supabase", iat, exp });

writeFileSync(outFile, `ANON_KEY=${anonKey}\nSERVICE_ROLE_KEY=${serviceRoleKey}\n`, {
  mode: 0o600,
});

console.log(`ANON_KEY written (len ${anonKey.length})`);
console.log(`SERVICE_ROLE_KEY written (len ${serviceRoleKey.length})`);
console.log(`Valid ${years} years (exp ${new Date(exp * 1000).toISOString()})`);
console.log(`Output: ${outFile} (mode 0600, gitignored). SERVICE_ROLE_KEY bypasses RLS — store it only as a platform secret.`);
