import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const script = join(root, "scripts", "build-fvi-production-from-protected-files.mjs");
const prodRef = "YOUR_PROJECT_REF";

function syntheticJwt(role: string, ref: string) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url");
  const claims = Buffer.from(JSON.stringify({ role, ref })).toString("base64url");
  return `${header}.${claims}.synthetic-test-signature`;
}

function runWithServiceKey(serviceKey: string) {
  const dir = mkdtempSync(join(tmpdir(), "fvi-prod-key-identity-"));
  const vaultPath = join(dir, "Falcon-Veritas-Keys.md");
  writeFileSync(vaultPath, [
    "<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->",
    `| \`SUPABASE_PROD_ANON_KEY\` | \`${syntheticJwt("anon", prodRef)}\` | active |`,
    `| \`SUPABASE_PROD_SERVICE_ROLE_KEY\` | \`${serviceKey}\` | active |`,
    "<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->",
  ].join("\n"));
  try {
    return spawnSync(process.execPath, [script], {
      cwd: root,
      env: { ...process.env, FVI_ALLOW_PROD_BUILD: "YES", FVI_VAULT_PATH: vaultPath },
      encoding: "utf8",
      timeout: 10_000,
    });
  } finally {
    unlinkSync(vaultPath);
    rmdirSync(dir);
  }
}

describe("protected PROD build key identity", () => {
  it.each([
    ["wrong project", syntheticJwt("service_role", "YOUR_PROJECT_REF")],
    ["wrong role", syntheticJwt("anon", prodRef)],
    ["malformed token", "synthetic-invalid-service-role-key"],
  ])("rejects a %s service key before any build or network call", (_label, key) => {
    const result = runWithServiceKey(key);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Protected PROD service-role key is not bound to the PROD project and role");
    expect(existsSync(join(root, ".env.production.local"))).toBe(false);
  });
});
