import { spawnSync } from "node:child_process";
import { readdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const PROD_REF = "YOUR_PROJECT_REF";
const DEV_REF = "YOUR_PROJECT_REF";
const root = process.cwd();
const surface = process.env.FVI_PROD_BUILD_SURFACE ?? "app";
if (!["app", "marketing"].includes(surface)) throw new Error("FVI_PROD_BUILD_SURFACE must be app or marketing");
const outputDirectory = path.join(root, surface === "marketing" ? "dist-marketing" : "dist");
const vaultPath = process.env.FVI_VAULT_PATH ?? "";
const anonFile = process.env.FVI_PROD_ANON_KEY_FILE ?? "";
const serviceFile = process.env.FVI_PROD_SERVICE_ROLE_KEY_FILE ?? "";
if (process.env.FVI_ALLOW_PROD_BUILD !== "YES") {
  throw new Error("Set FVI_ALLOW_PROD_BUILD=YES for an explicit isolated PROD build");
}
if (!vaultPath && (!path.isAbsolute(anonFile) || !path.isAbsolute(serviceFile))) {
  throw new Error("Set the canonical FVI vault or protected PROD key paths");
}

function vaultValue(markdown, key) {
  const start = markdown.indexOf("<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->");
  const end = markdown.indexOf("<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->");
  if (start < 0 || end <= start) throw new Error("Canonical FVI vault section is unavailable");
  const line = markdown
    .slice(start, end)
    .split(/\r?\n/u)
    .find((candidate) => candidate.startsWith(`| \`${key}\` |`));
  const value = line?.split("|")[2]?.trim().replace(/^`|`$/gu, "");
  if (!value) throw new Error(`Canonical FVI vault field ${key} is unavailable`);
  return value;
}
const vault = vaultPath ? await readFile(vaultPath, "utf8") : null;
const publishableKey = vault
  ? vaultValue(vault, "SUPABASE_PROD_ANON_KEY")
  : (await readFile(anonFile, "utf8")).trim();
const serviceRoleKey = vault
  ? vaultValue(vault, "SUPABASE_PROD_SERVICE_ROLE_KEY")
  : (await readFile(serviceFile, "utf8")).trim();
if (publishableKey.length < 30 || serviceRoleKey.length < 30) {
  throw new Error("Protected PROD key file is empty or invalid");
}
const publicKeyIsForProd = (() => {
  if (/^sb_publishable_[A-Za-z0-9._-]{20,}$/u.test(publishableKey)) return true;
  const parts = publishableKey.split(".");
  if (parts.length !== 3) return false;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return claims.role === "anon" && claims.ref === PROD_REF;
  } catch {
    return false;
  }
})();
if (!publicKeyIsForProd) {
  throw new Error("Protected PROD public key is not a publishable key for the PROD project");
}
const serviceRoleKeyIsForProd = (() => {
  const parts = serviceRoleKey.split(".");
  if (parts.length !== 3) return false;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return claims.role === "service_role" && claims.ref === PROD_REF;
  } catch {
    return false;
  }
})();
if (!serviceRoleKeyIsForProd) {
  throw new Error("Protected PROD service-role key is not bound to the PROD project and role");
}
const publicKeyResponse = await fetch(`https://${PROD_REF}.supabase.co/auth/v1/settings`, {
  headers: { apikey: publishableKey },
  signal: AbortSignal.timeout(10_000),
});
if (!publicKeyResponse.ok) {
  throw new Error(`Protected PROD public key validation failed with HTTP ${publicKeyResponse.status}`);
}
const serviceRoleResponse = await fetch(`https://${PROD_REF}.supabase.co/auth/v1/admin/users?page=1&per_page=1`, {
  headers: { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}` },
  signal: AbortSignal.timeout(10_000),
});
if (!serviceRoleResponse.ok) {
  throw new Error(`Protected PROD service-role key validation failed with HTTP ${serviceRoleResponse.status}`);
}

const generatedEnv = path.join(root, ".env.production.local");
const allowedOppositeReferenceDocs = [
  /^2026-09-22-gpt-5-6-sol-RETURN-[A-Za-z0-9_-]+\.js$/u,
  /^2026-09-22-kiloveritas-RETURN-[A-Za-z0-9_-]+\.js$/u,
  /^2026-09-23-gpt-5-6-sol-RETURN-[A-Za-z0-9_-]+\.js$/u,
  /^2026-09-25-codex-prod-dev-status-RETURN-[A-Za-z0-9_-]+\.js$/u,
  /^70_detailed_session_handover_2026-09-14-[A-Za-z0-9_-]+\.js$/u,
  /^ACCESS_AND_ENVIRONMENT-[A-Za-z0-9_-]+\.js$/u,
  /^FVI_DEV_JWT_FUTURE_INCIDENT_2026-09-23-[A-Za-z0-9_-]+\.js$/u,
  /^FVI_DEV_RESTART_RECOVERY_2026-09-23-[A-Za-z0-9_-]+\.js$/u,
  /^FVI_NATIVE_SINGLE_SESSION_2026-09-23-[A-Za-z0-9_-]+\.js$/u,
  /^FVI_RESOURCE_IDENTITY_HOSTED_READ_ONLY_PREFLIGHT_2026-09-24-[A-Za-z0-9_-]+\.js$/u,
  /^FVI_RESUME_RELEASE_READINESS_2026-09-25-[A-Za-z0-9_-]+\.js$/u,
  /^FVI_RUN_RESULTS_RPC_RELEASE_PREFLIGHT_2026-09-24-[A-Za-z0-9_-]+\.js$/u,
  /^FVI_SUPABASE_SUPPORT_DRAFT_2026-09-23-[A-Za-z0-9_-]+\.js$/u,
  /^NEW_CODEX_AGENT_START_HERE_2026-09-25-[A-Za-z0-9_-]+\.js$/u,
];
const lines = [
  `SUPABASE_PROJECT_ID=${PROD_REF}`,
  `SUPABASE_URL=https://${PROD_REF}.supabase.co`,
  `SUPABASE_PUBLISHABLE_KEY=${publishableKey}`,
  `SUPABASE_SERVICE_ROLE_KEY=${serviceRoleKey}`,
  `VITE_SUPABASE_PROJECT_ID=${PROD_REF}`,
  `VITE_SUPABASE_URL=https://${PROD_REF}.supabase.co`,
  `VITE_SUPABASE_PUBLISHABLE_KEY=${publishableKey}`,
  "VITE_PUBLIC_APP_URL=https://app.reconiq.example",
  "",
].join("\n");

async function filesUnder(directory) {
  const out = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) out.push(...(await filesUnder(target)));
    else if (entry.isFile()) out.push(target);
  }
  return out;
}

try {
  await writeFile(generatedEnv, lines, { encoding: "utf8", mode: 0o600 });
  const command = process.platform === "win32" ? "bun.exe" : "bun";
  const selectedEnvironment = {
    NODE_ENV: "production",
    SUPABASE_PROJECT_REF: PROD_REF,
    SUPABASE_PROJECT_ID: PROD_REF,
    SUPABASE_URL: `https://${PROD_REF}.supabase.co`,
    SUPABASE_PUBLISHABLE_KEY: publishableKey,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    VITE_SUPABASE_PROJECT_ID: PROD_REF,
    VITE_SUPABASE_URL: `https://${PROD_REF}.supabase.co`,
    VITE_SUPABASE_PUBLISHABLE_KEY: publishableKey,
    VITE_PUBLIC_APP_URL: "https://app.reconiq.example",
    PUBLIC_APP_URL: "https://app.reconiq.example",
  };
  const built = spawnSync(command, ["run", surface === "marketing" ? "build:marketing" : "build"], {
    cwd: root,
    env: { ...process.env, ...selectedEnvironment },
    stdio: "inherit",
    windowsHide: true,
  });
  if (built.status !== 0) throw new Error(`PROD build failed with status ${built.status}`);

  let serviceRoleMatches = 0;
  let devRefFiles = 0;
  let prodRefFiles = 0;
  let runtimeDevRefFiles = 0;
  for (const file of await filesUnder(outputDirectory)) {
    const bytes = await readFile(file);
    if (bytes.includes(Buffer.from(serviceRoleKey))) serviceRoleMatches += 1;
    if (bytes.includes(Buffer.from(DEV_REF))) {
      devRefFiles += 1;
      const relative = path.relative(outputDirectory, file).replaceAll("\\", "/");
      const base = path.basename(relative);
      const isDocsHandoverAsset = allowedOppositeReferenceDocs.some((pattern) => pattern.test(base));
      if (
        relative.startsWith("assets/") &&
        relative.endsWith(".js") &&
        !base.startsWith("OWNER_SESSION_TEST_PLAN-") &&
        !isDocsHandoverAsset
      ) {
        runtimeDevRefFiles += 1;
      }
    }
    if (bytes.includes(Buffer.from(PROD_REF))) prodRefFiles += 1;
  }
  if (serviceRoleMatches !== 0 || prodRefFiles === 0 || runtimeDevRefFiles !== 0) {
    throw new Error("PROD artifact identity or server-secret scan failed");
  }
  console.log(
    JSON.stringify({
      ok: true,
      surface,
      expected_project_ref: PROD_REF,
      prod_ref_files: prodRefFiles,
      dev_ref_files: devRefFiles,
      runtime_dev_ref_files: runtimeDevRefFiles,
      service_role_matches: serviceRoleMatches,
      generated_env_removed: true,
    }),
  );
} finally {
  await unlink(generatedEnv).catch(() => undefined);
}
