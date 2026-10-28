import { randomBytes, createHash } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const environment = process.env.FVI_AIDP_SCHEDULER_ENV ?? "";
const names = {
  prod: "FVI-AIDP-Job-Scheduler-PROD.md",
  dev: "FVI-AIDP-Job-Scheduler-DEV.md",
};
const expectedName = names[environment];
if (!expectedName) throw new Error("FVI_AIDP_SCHEDULER_ENV must be prod or dev");
if (process.env.FVI_ALLOW_AIDP_SCHEDULER_SECRET !== "YES") throw new Error("Explicit scheduler-secret gate is required");
const vaultPath = path.resolve(process.env.FVI_AIDP_SCHEDULER_VAULT_PATH ?? "");
const rawPath = path.resolve(process.env.FVI_AIDP_SCHEDULER_RAW_PATH ?? "");
if (path.basename(vaultPath) !== expectedName) throw new Error("Scheduler secret must use the environment-specific vault file");
try { await readFile(vaultPath, "utf8"); throw new Error("Refusing to replace an existing scheduler secret"); }
catch (error) { if (error?.code !== "ENOENT") throw error; }

const secret = randomBytes(32).toString("base64url");
const fingerprint = createHash("sha256").update(secret).digest("hex").slice(0, 12);
await Promise.all([
  writeFile(vaultPath, [
    `# FVI AIDP Job Scheduler — ${environment.toUpperCase()}`,
    "",
    "- Binding: AIDP_JOB_CRON_SECRET",
    `- Environment: ${environment.toUpperCase()}`,
    `- SHA-256 fingerprint: ${fingerprint}`,
    "- Purpose: authenticate only the dedicated AIDP scheduler to the matching FVI application cron endpoint",
    "",
    `- Secret: \`${secret}\``,
    "",
    "> New isolated credential. It does not replace or rescope SLA_CRON_HMAC.",
    "> Never copy into Git, logs, Graphify, Obsidian, or chat.",
    "",
  ].join("\n"), { encoding: "utf8", mode: 0o600 }),
  writeFile(rawPath, secret, { encoding: "utf8", mode: 0o600 }),
]);
await Promise.all([chmod(vaultPath, 0o600), chmod(rawPath, 0o600)]).catch(() => undefined);
console.log(JSON.stringify({ ok: true, environment, fingerprint, valuesPrinted: false }));
