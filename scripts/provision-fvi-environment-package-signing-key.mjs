import { createHash, randomBytes } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const vaultFile = process.env.FVI_SECURED_VAULT_MARKDOWN ?? "";
const legacyFile = process.env.FVI_LEGACY_ENV_PACKAGE_SIGNING_KEY_FILE ?? "";
if (process.env.FVI_ALLOW_NEW_ENV_PACKAGE_SIGNING_KEY !== "YES") {
  throw new Error("Set FVI_ALLOW_NEW_ENV_PACKAGE_SIGNING_KEY=YES");
}
if (!path.isAbsolute(vaultFile) || path.basename(vaultFile) !== "Falcon-Veritas-Keys.md") {
  throw new Error("Expected the canonical Falcon-Veritas-Keys.md vault file");
}

const marker = "<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->";
const endMarker = "<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->";
const current = await readFile(vaultFile, "utf8");
const start = current.indexOf(marker);
const end = current.indexOf(endMarker);
if (start < 0 || end <= start) throw new Error("Canonical FVI vault section is unavailable");
const section = current.slice(start, end);
const existing = section.match(/`ENVIRONMENT_PACKAGE_HMAC_KEY`\s*\|\s*`([^`]+)`/u)?.[1];
let value = existing;
let reused = Boolean(existing);
if (!value && legacyFile) {
  if (!path.isAbsolute(legacyFile)) throw new Error("Legacy signing-key path must be absolute");
  value = (await readFile(legacyFile, "utf8")).match(
    /`ENVIRONMENT_PACKAGE_HMAC_KEY`\s*\|\s*`([^`]+)`/u,
  )?.[1];
}
if (!value) value = randomBytes(48).toString("base64url");
if (value.length < 43 || /[\r\n|`]/u.test(value)) throw new Error("Signing key is invalid");
if (!existing) {
  const row = `| \`ENVIRONMENT_PACKAGE_HMAC_KEY\` | \`${value}\` | active |\n`;
  const updated = `${current.slice(0, end)}${row}${current.slice(end)}`;
  const temporary = `${vaultFile}.codex-signing-key`;
  await writeFile(temporary, updated, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, vaultFile);
}

console.log(
  JSON.stringify({
    ok: true,
    reused,
    bytes: 48,
    fingerprint: createHash("sha256").update(value).digest("hex"),
    value_printed: false,
  }),
);
