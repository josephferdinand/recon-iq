import { createHash, randomBytes } from "node:crypto";
import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const vaultPath = process.env.FVI_SECURED_VAULT_MARKDOWN ?? "";
if (process.env.FVI_ALLOW_NEW_APP_DATA_KEYS !== "YES") {
  throw new Error("Set FVI_ALLOW_NEW_APP_DATA_KEYS=YES after proving both app Vaults are empty");
}
if (!path.isAbsolute(vaultPath) || path.basename(vaultPath) !== "Falcon-Veritas-Keys.md") {
  throw new Error("Expected the canonical Falcon-Veritas-Keys.md secured-vault path");
}

const current = await readFile(vaultPath, "utf8");
for (const field of ["APP_DATA_ENC_KEY_PROD", "APP_DATA_ENC_KEY_DEV"]) {
  if (current.includes(field)) {
    throw new Error(`${field} already exists; refusing to rotate or replace it`);
  }
}

const prod = randomBytes(32).toString("base64url");
const dev = randomBytes(32).toString("base64url");
const fingerprint = (value) => createHash("sha256").update(value).digest("hex");
const section = [
  "",
  "### Environment-specific in-app Vault encryption keys",
  "",
  "> Provisioned only after readback proved both `app_vault_secrets` tables were empty.",
  "> Runtime binding name remains `APP_DATA_ENC_KEY`; PROD and DEV receive different values.",
  "",
  "| Field | Value | Runtime variable | Scope | Status | Notes |",
  "|---|---|---|---|---|---|",
  `| \`APP_DATA_ENC_KEY_PROD\` | \`${prod}\` | \`APP_DATA_ENC_KEY\` | PROD | active | 256-bit; do not copy outside secured vault |`,
  `| \`APP_DATA_ENC_KEY_DEV\` | \`${dev}\` | \`APP_DATA_ENC_KEY\` | DEV/UAT | generated, not yet bound | 256-bit; bind only after PROD validation |`,
  "",
].join("\n");

const temporary = `${vaultPath}.codex-new`;
await writeFile(temporary, `${current.trimEnd()}\n${section}`, {
  encoding: "utf8",
  mode: 0o600,
});
await rename(temporary, vaultPath);
await chmod(vaultPath, 0o600).catch(() => undefined);

console.log(
  JSON.stringify({
    ok: true,
    fields: ["APP_DATA_ENC_KEY_PROD", "APP_DATA_ENC_KEY_DEV"],
    prod_fingerprint: fingerprint(prod),
    dev_fingerprint: fingerprint(dev),
    key_bytes_each: 32,
    values_printed: false,
  }),
);
