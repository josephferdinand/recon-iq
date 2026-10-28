import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_REF_PATTERN = /^[a-z]{20}$/u;
const VERSION_PATTERN = /^\d{14}$/u;
const execFileAsync = promisify(execFile);

function readFlag(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function validateVersions(versions, source) {
  if (versions.some((version) => !VERSION_PATTERN.test(version))) {
    throw new Error(`${source} returned an invalid migration version`);
  }
  if (new Set(versions).size !== versions.length) {
    throw new Error(`${source} returned duplicate migration versions`);
  }
  return [...versions].sort();
}

export function parseSupabaseMigrationListOutput(value) {
  const localVersions = [];
  const remoteVersions = [];
  let sawHeader = false;

  for (const line of String(value).split(/\r?\n/u)) {
    if (/\bLocal\s*\|\s*Remote\b/u.test(line)) {
      sawHeader = true;
      continue;
    }
    if (!line.includes("|")) continue;
    const [localCell = "", remoteCell = ""] = line.split("|");
    const local = localCell.trim();
    const remote = remoteCell.trim();
    if (/^-+$/u.test(local) || (!local && !remote)) continue;
    if (local && !VERSION_PATTERN.test(local)) {
      throw new Error("Supabase CLI returned an invalid local migration version");
    }
    if (remote && !VERSION_PATTERN.test(remote)) {
      throw new Error("Supabase CLI returned an invalid remote migration version");
    }
    if (local) localVersions.push(local);
    if (remote) remoteVersions.push(remote);
  }

  if (!sawHeader) throw new Error("Supabase CLI migration-list header was not found");
  return {
    localVersions: validateVersions(localVersions, "Supabase CLI local ledger"),
    remoteVersions: validateVersions(remoteVersions, "Supabase CLI remote ledger"),
  };
}

function resolveCliInvocation() {
  if (process.env.FVI_SUPABASE_CLI_ENTRY) {
    return { command: process.execPath, prefix: [path.resolve(process.env.FVI_SUPABASE_CLI_ENTRY)] };
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    if (!appData) throw new Error("APPDATA is unavailable; set FVI_SUPABASE_CLI_ENTRY");
    return {
      command: process.execPath,
      prefix: [path.join(appData, "npm", "node_modules", "supabase", "dist", "supabase.js")],
    };
  }
  return { command: "supabase", prefix: [] };
}

export async function listMigrationLedgerWithCli({
  projectRef,
  accessToken,
  projectRoot,
  linkedProjectRef,
  execImpl = execFileAsync,
}) {
  if (!PROJECT_REF_PATTERN.test(projectRef ?? "")) {
    throw new Error("Supabase project reference must be exactly 20 lowercase letters");
  }
  if (!accessToken?.trim()) throw new Error("Supabase Management API token is empty");
  const linkedRef =
    linkedProjectRef ??
    (await readFile(path.join(projectRoot, "supabase", ".temp", "project-ref"), "utf8")).trim();
  if (linkedRef !== projectRef) {
    throw new Error("Supabase linked-project identity does not match the expected project");
  }

  const invocation = resolveCliInvocation();
  const { stdout = "", stderr = "" } = await execImpl(
    invocation.command,
    [...invocation.prefix, "migration", "list", "--linked", "--log-level", "error"],
    {
      cwd: projectRoot,
      env: { ...process.env, SUPABASE_ACCESS_TOKEN: accessToken.trim() },
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    },
  );
  return parseSupabaseMigrationListOutput(`${stdout}\n${stderr}`);
}

async function main() {
  const projectRef = readFlag("--project-ref") ?? process.env.FVI_EXPECTED_SUPABASE_REF;
  const patFile = readFlag("--pat-file") ?? process.env.FVI_SUPABASE_PAT_FILE;
  const outputFile = readFlag("--output") ?? process.env.FVI_REMOTE_MIGRATION_VERSIONS_FILE;
  if (!patFile) throw new Error("Set FVI_SUPABASE_PAT_FILE or pass --pat-file");
  if (!outputFile) throw new Error("Set FVI_REMOTE_MIGRATION_VERSIONS_FILE or pass --output");

  const accessToken = await readFile(path.resolve(patFile), "utf8");
  const projectRoot = path.resolve(
    readFlag("--project-root") ??
      process.env.FVI_SUPABASE_PROJECT_ROOT ??
      fileURLToPath(new URL("..", import.meta.url)),
  );
  const { localVersions, remoteVersions: versions } = await listMigrationLedgerWithCli({
    projectRef,
    accessToken,
    projectRoot,
  });
  const resolvedOutput = path.resolve(outputFile);
  await mkdir(path.dirname(resolvedOutput), { recursive: true });
  await writeFile(resolvedOutput, `${versions.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });

  console.log(`expected_project_ref=${projectRef}`);
  console.log(`local_migration_count=${localVersions.length}`);
  console.log(`remote_migration_count=${versions.length}`);
  console.log(`first_remote_version=${versions[0] ?? "NONE"}`);
  console.log(`last_remote_version=${versions.at(-1) ?? "NONE"}`);
  console.log("PASS official_cli_migration_ledger_export");
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) await main();
