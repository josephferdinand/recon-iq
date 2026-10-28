// Zeno sidecar. Retains or runs the unchanged canonical native read harness.
// No hosted connection, schema application, fake permission response or MFA claim.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const rootValue = process.env.FVI_GOVERNANCE_CATALOG_ROOT;
const environment = process.env.FVI_GOVERNANCE_CATALOG_ENV;
if (!rootValue || !["PROD", "DEV"].includes(environment)) throw new Error("Set explicit FVI_GOVERNANCE_CATALOG_ROOT and FVI_GOVERNANCE_CATALOG_ENV=PROD|DEV");
const root = path.resolve(rootValue);
const canonical = path.join(repo, "tests/governance-audit-native-qualification.mjs");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const captures = [], metadataHashes = {};
for (const suffix of ["", "-EXTENDED", "-SUPPLEMENT"]) {
  const name = `FVI-GOVERNANCE-CATALOG-${environment}${suffix}-20261002.json`;
  const bytes = readFileSync(path.join(root, name));
  const doc = JSON.parse(bytes.toString("utf8"));
  if (doc.read_only !== true || !doc.rows?.[0]?.catalog) throw new Error(`Actual read-only metadata capture required: ${name}`);
  metadataHashes[name] = sha(bytes); captures.push(doc.rows[0].catalog);
}
const helpers = new Map();
for (const helper of captures.flatMap(capture => capture.helpers ?? [])) helpers.set(`${helper.schema}.${helper.name}`, helper);
const requiredHelpers = ["auth.uid", "auth.role", "auth.jwt", "private.has_platform_role", "private.is_platform_admin", "public.is_platform_admin", "private.has_tenant_role", "public.has_tenant_role", "private.is_tenant_member", "public.is_tenant_member", "public.effective_user_permissions", "public.user_has_permission"];
for (const key of requiredHelpers) if (!helpers.get(key)?.definition) throw new Error(`Precise metadata query needed for pg_get_functiondef of ${key}; do not stub`);

const args = process.argv.slice(2);
const retainIndex = args.indexOf("--retain");
let receipt;
if (retainIndex >= 0) {
  if (!args[retainIndex + 1]) throw new Error("--retain requires an actual canonical receipt.json path");
  receipt = JSON.parse(readFileSync(args[retainIndex + 1], "utf8"));
} else {
  const result = spawnSync(process.execPath, [canonical], { cwd: repo, env: { ...process.env, FVI_GOVERNANCE_CATALOG_ROOT: root, FVI_GOVERNANCE_CATALOG_ENV: environment }, encoding: "utf8", timeout: 90000, maxBuffer: 4 * 1024 * 1024 });
  const lastLine = String(result.stdout ?? "").trim().split(/\r?\n/u).at(-1);
  if (result.error || !lastLine) throw new Error("Canonical native harness failed before a receipt; inspect its retained output, do not bypass missing authority");
  receipt = JSON.parse(lastLine);
  if (result.status !== 0) {
    process.stdout.write(`${JSON.stringify({ status: "FAIL", environment, exact_native_error: receipt.error, retained_output: receipt.output, metadata_sha256: metadataHashes })}\n`);
    process.exitCode = 1;
  }
}
if (receipt.status !== "PASS" || receipt.environment !== environment || receipt.guards !== 16 || receipt.stop_error) throw new Error("Only a completed, stopped canonical 16-assertion native read receipt can be retained");
for (const [name, hash] of Object.entries(metadataHashes)) if (receipt.metadata_sha256?.[name] !== hash) throw new Error(`Current capture drift from retained proof: ${name}`);
const sql = readFileSync(path.join(receipt.output, "qualification.sql"));
const log = readFileSync(path.join(receipt.output, "qualification.log"));
if (sha(sql) !== receipt.sql_sha256 || !/PostgreSQL 17\.6 /u.test(log.toString("utf8"))) throw new Error("Retained native SQL/log hashes or actual fixture engine mismatch");
const helperClosure = requiredHelpers.map(key => {
  const helper = helpers.get(key);
  if (!sql.toString("utf8").includes(helper.definition)) throw new Error(`Retained fixture does not contain the exact captured source body: ${key}`);
  return { qualified_name: key, identity: helper.identity, definition_sha256: sha(helper.definition), captured_owner: helper.owner ?? null, captured_acl: helper.acl ?? null };
});
const state = spawnSync("docker", ["inspect", "--format", "{{.State.Status}}", receipt.container], { encoding: "utf8", timeout: 10000 });
if (state.status !== 0 || state.stdout.trim() !== "exited") throw new Error("Retained own canonical fixture must be stopped; no restart or cleanup is performed by retain mode");
const output = path.join(root, "ZENO-GOVERNANCE-AUDIT-NATIVE-20261002", environment, randomUUID().slice(0, 8));
mkdirSync(output, { recursive: true });
for (const name of ["receipt.json", "qualification.sql", "qualification.log"]) copyFileSync(path.join(receipt.output, name), path.join(output, name));
const proof = {
  status: "PASS", lane: "Zeno — bounded native governance audit read policy", at: new Date().toISOString(), environment,
  assertions: receipt.guards, metadata_sha256: metadataHashes, helper_closure: helperClosure,
  canonical_harness_sha256: sha(readFileSync(canonical)), audit_module_source_sha256: sha(readFileSync(path.join(repo, "src/lib/governance-audit.functions.ts"))),
  caller_middleware_source_sha256: sha(readFileSync(path.join(repo, "src/integrations/supabase/auth-middleware.ts"))),
  native_sql_sha256: receipt.sql_sha256, native_log_sha256: sha(log), canonical_receipt: receipt,
  scope: "Actual captured helper bodies and read-policy SQL; synthetic LOCAL callers/rows, authenticated-role reads, 16 canonical guards. Source handler/middleware hashes are provenance, not a handler-runtime claim.",
  omissions: ["Nullable projections omit defaults, FKs, checks and write/audit-chain triggers", "Supplementary private.has_platform_role and public.effective_user_permissions owner/ACL metadata absent; canonical local owner fallback is postgres, not hosted ACL/owner proof", "No native Auth/MFA login, hosted API/browser flow, migration application or full-governance acceptance"],
  fixture_state: "exited", original_output_preserved: receipt.output, output,
};
writeFileSync(path.join(output, "ZENO-AUDIT-NATIVE-PROOF.json"), `${JSON.stringify(proof, null, 2)}\n`, { flag: "wx" });
process.stdout.write(`${JSON.stringify({ status: proof.status, environment, assertions: proof.assertions, helper_count: helperClosure.length, output, native_sql_sha256: proof.native_sql_sha256 })}\n`);
