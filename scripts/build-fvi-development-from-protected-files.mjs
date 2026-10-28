import { spawnSync } from "node:child_process";
import { readdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const DEV_REF = "YOUR_PROJECT_REF";
const PROD_REF = "YOUR_PROJECT_REF";
const root = process.cwd();
const vaultPath = process.env.FVI_VAULT_PATH ?? "";
const anonFile = process.env.FVI_DEV_ANON_KEY_FILE ?? "";
const serviceFile = process.env.FVI_DEV_SERVICE_ROLE_KEY_FILE ?? "";
if (process.env.FVI_ALLOW_DEV_BUILD !== "YES") throw new Error("Set FVI_ALLOW_DEV_BUILD=YES");
if (!vaultPath && (!path.isAbsolute(anonFile) || !path.isAbsolute(serviceFile)))
  throw new Error("Set the canonical FVI vault or protected DEV key paths");

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
  ? vaultValue(vault, "SUPABASE_DEV_ANON_KEY")
  : (await readFile(anonFile, "utf8")).trim();
const serviceRoleKey = vault
  ? vaultValue(vault, "SUPABASE_DEV_SERVICE_ROLE_KEY")
  : (await readFile(serviceFile, "utf8")).trim();
if (publishableKey.length < 30 || serviceRoleKey.length < 30)
  throw new Error("Protected DEV key file is invalid");
const generatedEnv = path.join(root, ".env.development.local");
// Historical documentation is shipped as lazy client chunks by the in-app docs
// registry. Those chunks may name the PROD project as evidence, but they are not
// executable runtime configuration. Keep this allowlist anchored and filename-only.
const allowedOppositeReferenceDocs = [
  /^58_reference_data_local_assurance-[A-Za-z0-9_-]+\.js$/u,
  /^2026-09-22-gpt-5-6-sol-RETURN-[A-Za-z0-9_-]+\.js$/u,
  /^2026-09-22-kiloveritas-RETURN-[A-Za-z0-9_-]+\.js$/u,
  /^2026-09-23-gpt-5-6-sol-RETURN-[A-Za-z0-9_-]+\.js$/u,
  /^2026-09-25-codex-prod-dev-status-RETURN-[A-Za-z0-9_-]+\.js$/u,
  /^63_prod_postgrest_pgrst303_incident-[A-Za-z0-9_-]+\.js$/u,
  /^70_detailed_session_handover_2026-09-14-[A-Za-z0-9_-]+\.js$/u,
  /^ACCESS_AND_ENVIRONMENT-[A-Za-z0-9_-]+\.js$/u,
  /^FVI_ASSURANCE_LEGACY_BU_OWNER_DECISION_2026-09-25-[A-Za-z0-9_-]+\.js$/u,
  /^FVI_DEV_JWT_FUTURE_INCIDENT_2026-09-23-[A-Za-z0-9_-]+\.js$/u,
  /^FVI_MY_TEMPLATES_WORKSPACE_GATE_2026-09-25-[A-Za-z0-9_-]+\.js$/u,
  /^FVI_NATIVE_SINGLE_SESSION_2026-09-23-[A-Za-z0-9_-]+\.js$/u,
  /^FVI_PROD_DATA_API_INCIDENT_2026-09-23-[A-Za-z0-9_-]+\.js$/u,
  /^FVI_PROD_DASHBOARD_BASIS_2026-09-24-[A-Za-z0-9_-]+\.js$/u,
  /^FVI_PROD_ISOLATED_CANDIDATE_ACCESS_2026-09-23-[A-Za-z0-9_-]+\.js$/u,
  /^FVI_PROD_RESTART_RECOVERY_2026-09-23-[A-Za-z0-9_-]+\.js$/u,
  /^FVI_RESOURCE_IDENTITY_HOSTED_READ_ONLY_PREFLIGHT_2026-09-24-[A-Za-z0-9_-]+\.js$/u,
  /^FVI_RESUME_RELEASE_READINESS_2026-09-25-[A-Za-z0-9_-]+\.js$/u,
  /^FVI_RUN_RESULTS_RPC_RELEASE_PREFLIGHT_2026-09-24-[A-Za-z0-9_-]+\.js$/u,
  /^FVI_SUPABASE_SUPPORT_DRAFT_2026-09-23-[A-Za-z0-9_-]+\.js$/u,
  /^NEW_CODEX_AGENT_START_HERE_2026-09-25-[A-Za-z0-9_-]+\.js$/u,
  /^rate-limit-server-threat-model-[A-Za-z0-9_-]+\.js$/u,
];
const lines = [
  `SUPABASE_PROJECT_ID=${DEV_REF}`,
  `SUPABASE_URL=https://${DEV_REF}.supabase.co`,
  `SUPABASE_PUBLISHABLE_KEY=${publishableKey}`,
  `SUPABASE_SERVICE_ROLE_KEY=${serviceRoleKey}`,
  `VITE_SUPABASE_PROJECT_ID=${DEV_REF}`,
  `VITE_SUPABASE_URL=https://${DEV_REF}.supabase.co`,
  `VITE_SUPABASE_PUBLISHABLE_KEY=${publishableKey}`,
  "VITE_PUBLIC_APP_URL=https://dev.app.reconiq.example",
  "",
].join("\n");

async function filesUnder(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(target)));
    else if (entry.isFile()) files.push(target);
  }
  return files;
}

try {
  await writeFile(generatedEnv, lines, { encoding: "utf8", mode: 0o600 });
  const selectedEnvironment = {
    NODE_ENV: "production",
    SUPABASE_PROJECT_REF: DEV_REF,
    SUPABASE_PROJECT_ID: DEV_REF,
    SUPABASE_URL: `https://${DEV_REF}.supabase.co`,
    SUPABASE_PUBLISHABLE_KEY: publishableKey,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    VITE_SUPABASE_PROJECT_ID: DEV_REF,
    VITE_SUPABASE_URL: `https://${DEV_REF}.supabase.co`,
    VITE_SUPABASE_PUBLISHABLE_KEY: publishableKey,
    VITE_PUBLIC_APP_URL: "https://dev.app.reconiq.example",
  };
  const built = spawnSync(process.platform === "win32" ? "bun.exe" : "bun", ["run", "build:dev"], {
    cwd: root,
    env: { ...process.env, ...selectedEnvironment },
    stdio: "inherit",
    windowsHide: true,
  });
  if (built.status !== 0) throw new Error(`DEV build failed with status ${built.status}`);
  const deployConfigPath = path.join(root, "dist", "_worker.js", "wrangler.json");
  const [deployConfig, devConfig] = await Promise.all([
    readFile(deployConfigPath, "utf8").then(JSON.parse),
    readFile(path.join(root, "wrangler.staging.jsonc"), "utf8").then((value) =>
      JSON.parse(value.replace(/,\s*([}\]])/gu, "$1")),
    ),
  ]);
  deployConfig.name = devConfig.name;
  deployConfig.vars = devConfig.vars;
  deployConfig.r2_buckets = devConfig.r2_buckets;
  deployConfig.services = devConfig.services;
  await writeFile(deployConfigPath, `${JSON.stringify(deployConfig, null, 2)}\n`, "utf8");
  if (
    deployConfig.vars?.SUPABASE_PROJECT_ID !== DEV_REF ||
    deployConfig.r2_buckets?.some((item) => !item.bucket_name.endsWith("-dev")) ||
    deployConfig.services?.some(
      (item) => !item.service.endsWith("-dev") && !item.service.endsWith("-prod"),
    ) ||
    deployConfig.services?.find((item) => item.binding === "AIDP_DOCUMENT_SERVICE")?.service !==
      "fvi-aidp-document-service-dev" ||
    deployConfig.services?.find((item) => item.binding === "CONNECTOR_GATEWAY")?.service !==
      "fvi-connector-gateway-dev" ||
    deployConfig.services?.find((item) => item.binding === "ENVIRONMENT_CONTROL_PLANE")?.service !==
      "fvi-environment-ingress-prod"
  ) {
    throw new Error("DEV generated deployment bindings do not match wrangler.staging.jsonc");
  }
  let serviceRoleMatches = 0;
  let devRefFiles = 0;
  let runtimeProdRefFiles = 0;
  for (const file of await filesUnder(path.join(root, "dist"))) {
    const bytes = await readFile(file);
    if (bytes.includes(Buffer.from(serviceRoleKey))) serviceRoleMatches += 1;
    if (bytes.includes(Buffer.from(DEV_REF))) devRefFiles += 1;
    if (bytes.includes(Buffer.from(PROD_REF))) {
      const relative = path.relative(path.join(root, "dist"), file).replaceAll("\\", "/");
      const basename = path.basename(relative);
      if (
        relative.startsWith("assets/") &&
        relative.endsWith(".js") &&
        !basename.startsWith("OWNER_SESSION_TEST_PLAN-") &&
        !allowedOppositeReferenceDocs.some((pattern) => pattern.test(basename))
      ) {
        runtimeProdRefFiles += 1;
      }
    }
  }
  if (serviceRoleMatches !== 0 || devRefFiles === 0 || runtimeProdRefFiles !== 0) {
    throw new Error("DEV artifact identity or secret scan failed");
  }
  console.log(
    JSON.stringify({
      ok: true,
      expected_project_ref: DEV_REF,
      dev_ref_files: devRefFiles,
      runtime_prod_ref_files: runtimeProdRefFiles,
      generated_deployment_bindings: "dev",
      service_role_matches: serviceRoleMatches,
      generated_env_removed: true,
    }),
  );
} finally {
  await unlink(generatedEnv).catch(() => undefined);
}
