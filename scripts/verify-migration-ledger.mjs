import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATION_NAME_PATTERN = /^(\d{14})_(.+)\.sql$/u;
const VERSION_PATTERN = /^\d{14}$/u;

export async function buildMigrationManifest(migrationsDirectory) {
  const directoryEntries = await readdir(migrationsDirectory, { withFileTypes: true });
  const filenames = directoryEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, "en"));

  if (filenames.length === 0) throw new Error("No SQL migration files were found");

  const seenVersions = new Set();
  const entries = [];
  for (const filename of filenames) {
    const match = filename.match(MIGRATION_NAME_PATTERN);
    if (!match) throw new Error(`Invalid migration filename: ${filename}`);

    const [, version, name] = match;
    if (seenVersions.has(version)) throw new Error(`Duplicate migration version: ${version}`);
    seenVersions.add(version);

    const contents = await readFile(path.join(migrationsDirectory, filename));
    const sha256 = createHash("sha256").update(contents).digest("hex");
    entries.push({ version, name, filename, sha256 });
  }

  const fingerprint = createHash("sha256")
    .update(entries.map((entry) => `${entry.version}\t${entry.name}\t${entry.sha256}`).join("\n"))
    .digest("hex");

  return { entries, fingerprint };
}

export function parseRemoteMigrationVersions(value) {
  const versions = value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const version of versions) {
    if (!VERSION_PATTERN.test(version)) {
      throw new Error(`Invalid remote migration version output: ${version}`);
    }
  }

  const uniqueVersions = new Set(versions);
  if (uniqueVersions.size !== versions.length) {
    throw new Error("Remote migration ledger contains duplicate versions");
  }

  return [...uniqueVersions].sort();
}

export function compareMigrationVersions(localVersions, remoteVersions) {
  const local = new Set(localVersions);
  const remote = new Set(remoteVersions);
  return {
    missingRemotely: [...local].filter((version) => !remote.has(version)).sort(),
    remoteOnly: [...remote].filter((version) => !local.has(version)).sort(),
  };
}

export function summarizeVersions(versions, limit = 20) {
  const shown = versions.slice(0, limit);
  return {
    value: shown.join(","),
    omitted: Math.max(0, versions.length - shown.length),
  };
}

function readFlag(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const migrationsDirectory =
    readFlag("--migrations-dir") ??
    fileURLToPath(new URL("../supabase/migrations", import.meta.url));
  const remoteVersionsFile =
    readFlag("--remote-versions") ?? process.env.FVI_REMOTE_MIGRATION_VERSIONS_FILE;
  const requireRemote = process.argv.includes("--require-remote");
  const expectedRef = readFlag("--expected-ref") ?? process.env.FVI_EXPECTED_SUPABASE_REF;
  const manifest = await buildMigrationManifest(migrationsDirectory);

  console.log(`migration_count=${manifest.entries.length}`);
  console.log(`migration_manifest_sha256=${manifest.fingerprint}`);
  console.log("PASS local_migration_manifest");

  if (!remoteVersionsFile) {
    if (requireRemote) {
      throw new Error(
        "Set FVI_REMOTE_MIGRATION_VERSIONS_FILE or pass --remote-versions for remote comparison",
      );
    }
    return;
  }
  if (!expectedRef || !/^[a-z]{20}$/u.test(expectedRef)) {
    throw new Error("Remote comparison requires FVI_EXPECTED_SUPABASE_REF or --expected-ref");
  }

  const remoteVersions = parseRemoteMigrationVersions(await readFile(remoteVersionsFile, "utf8"));
  const comparison = compareMigrationVersions(
    manifest.entries.map((entry) => entry.version),
    remoteVersions,
  );

  console.log(`expected_project_ref=${expectedRef}`);
  console.log(`remote_migration_count=${remoteVersions.length}`);
  console.log(`missing_remotely=${comparison.missingRemotely.length}`);
  console.log(`remote_only=${comparison.remoteOnly.length}`);
  if (comparison.missingRemotely.length > 0) {
    const summary = summarizeVersions(comparison.missingRemotely);
    console.log(`missing_remote_versions_sample=${summary.value}`);
    console.log(`missing_remote_versions_omitted=${summary.omitted}`);
  }
  if (comparison.remoteOnly.length > 0) {
    const summary = summarizeVersions(comparison.remoteOnly);
    console.log(`remote_only_versions_sample=${summary.value}`);
    console.log(`remote_only_versions_omitted=${summary.omitted}`);
  }

  const passed = comparison.missingRemotely.length === 0 && comparison.remoteOnly.length === 0;
  console.log(`${passed ? "PASS" : "FAIL"} remote_migration_ledger_matches`);
  if (!passed) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main();
}
