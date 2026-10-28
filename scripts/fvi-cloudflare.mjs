import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

// Read only the existing owner-managed account credential. Markdown wrappers
// are formatting, not part of the credential; never echo or rewrite its value.
const vaultPath = process.env.FVI_VAULT_PATH;
if (!vaultPath || !path.isAbsolute(vaultPath) || path.basename(vaultPath) !== "Falcon-Veritas-Keys.md") {
  throw new Error("Set FVI_VAULT_PATH to the canonical secured vault");
}
const lines = (await readFile(vaultPath, "utf8")).split(/\r?\n/u);
const env = { ...process.env };
for (const key of ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]) {
  const rows = lines.filter((line) => line.startsWith("|")
    && line.split("|")[1].trim().replace(/^[`*]+|[`*]+$/gu, "") === key);
  if (rows.length !== 1) throw new Error(`Expected one vault field: ${key}`);
  const value = rows[0].split("|")[2].trim().replace(/^`|`$/gu, "").replace(/^<|>$/gu, "");
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error(`Invalid credential formatting: ${key}`);
  env[key] = value;
}
const args = process.argv.slice(2);
if (args.length === 0) throw new Error("Supply a Wrangler command");
const result = spawnSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", ...args], {
  env, stdio: "inherit", windowsHide: true,
});
if (result.error) throw new Error("Could not start Wrangler");
process.exitCode = result.status ?? 1;
