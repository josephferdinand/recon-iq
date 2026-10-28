import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_SCREEN_FIXTURES, discoverUiScreens } from "./screen-coverage-catalog.mjs";

const BASE_REQUIRED = new Set(["public-browser", "public-api", "dev-live-rls"]);

function result(id, ready, detail) {
  return { id, state: ready ? "PASS" : "BLOCKED", detail };
}

function validFviHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      (url.hostname === "reconiq.example" || url.hostname.endsWith(".reconiq.example"))
      ? url
      : null;
  } catch {
    return null;
  }
}

export function assessOwnerTestReadiness({
  environment = process.env,
  root = process.cwd(),
  fileExists = existsSync,
} = {}) {
  const baseUrlValue =
    environment.FVI_E2E_BASE_URL ??
    environment.FVI_OWNER_BASE_URL ??
    "https://dev.app.reconiq.example";
  const baseUrl = validFviHttpsUrl(baseUrlValue);
  const storagePath = environment.FVI_OWNER_STORAGE_STATE?.trim();
  const authenticated =
    environment.FVI_RUN_AUTHENTICATED_SCREEN_MATRIX === "YES" &&
    Boolean(storagePath && fileExists(storagePath));
  const secretRoot =
    environment.FVI_SECRET_ROOT ?? "C:\\Users\\Alice Yesudasan\\.fvi-secrets";
  const rlsSecretFiles = ["SUPABASE_DEV_ANON_KEY", "SUPABASE_DEV_SERVICE_ROLE_KEY"].map((name) =>
    path.join(secretRoot, name),
  );
  const screens = discoverUiScreens(root);
  const fixtureEnvironments = [
    ...new Set(screens.flatMap((screen) => screen.parameters.map((item) => item.environment))),
  ].sort();
  const missingFixtureEnvironments = fixtureEnvironments.filter(
    (name) => !(environment[name]?.trim() ?? DEFAULT_SCREEN_FIXTURES[name]),
  );
  const uploadFixtures = ["ledger-small.csv", "statement-small.csv"].map((name) =>
    path.join(root, "tests", "fixtures", "reconciliation", name),
  );
  const uploadReady =
    authenticated &&
    environment.FVI_ALLOW_OWNER_UPLOAD === "YES" &&
    Boolean(environment.FVI_E2E_TENANT_SLUG?.trim()) &&
    baseUrl?.hostname === "dev.app.reconiq.example" &&
    uploadFixtures.every(fileExists);

  return {
    baseUrl: baseUrlValue,
    screenCount: screens.length,
    checks: [
      result(
        "public-browser",
        Boolean(baseUrl),
        baseUrl ? "HTTPS FVI target selected" : "FVI_E2E_BASE_URL must be an HTTPS ReconIQ host",
      ),
      result(
        "public-api",
        Boolean(baseUrl),
        baseUrl ? "public API target selected" : "public API target is invalid",
      ),
      result(
        "dev-live-rls",
        rlsSecretFiles.every(fileExists),
        rlsSecretFiles.every(fileExists)
          ? "protected DEV key files are present"
          : "protected DEV key files are missing",
      ),
      result(
        "authenticated-screens",
        authenticated,
        authenticated
          ? "short-lived owner storage state is present and explicitly enabled"
          : "run bun run test:owner:capture, then set FVI_OWNER_STORAGE_STATE and FVI_RUN_AUTHENTICATED_SCREEN_MATRIX=YES",
      ),
      result(
        "dynamic-screen-fixtures",
        missingFixtureEnvironments.length === 0,
        missingFixtureEnvironments.length === 0
          ? `all ${fixtureEnvironments.length} named fixture environments are present`
          : `missing ${missingFixtureEnvironments.join(", ")}`,
      ),
      result(
        "reconciliation-upload",
        uploadReady,
        uploadReady
          ? "DEV-only upload gate, tenant, owner state, and paired fixtures are ready"
          : "requires DEV target, owner state, tenant slug, FVI_ALLOW_OWNER_UPLOAD=YES, and paired fixtures",
      ),
      result(
        "accessibility-performance",
        Boolean(baseUrl),
        baseUrl
          ? "public Axe and navigation budgets can run; authenticated coverage follows owner state"
          : "valid FVI browser target is missing",
      ),
    ],
  };
}

export function requiredCheckIds(scope) {
  if (scope === "full") {
    return new Set([
      ...BASE_REQUIRED,
      "authenticated-screens",
      "dynamic-screen-fixtures",
      "reconciliation-upload",
      "accessibility-performance",
    ]);
  }
  if (scope === "authenticated") {
    return new Set([...BASE_REQUIRED, "authenticated-screens", "accessibility-performance"]);
  }
  return BASE_REQUIRED;
}

function main() {
  const scope =
    process.argv.find((argument) => argument.startsWith("--require="))?.split("=", 2)[1] ?? "base";
  const report = assessOwnerTestReadiness();
  const required = requiredCheckIds(scope);

  console.log(`owner_test_target=${report.baseUrl}`);
  console.log(`screen_count=${report.screenCount}`);
  for (const check of report.checks) {
    console.log(`${check.state} ${check.id} ${check.detail}`);
  }

  const blockedRequired = report.checks.filter(
    (check) => required.has(check.id) && check.state !== "PASS",
  );
  if (blockedRequired.length > 0) {
    console.error(`BLOCKED required_owner_test_gates=${blockedRequired.map((item) => item.id).join(",")}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS owner_test_readiness scope=${scope}`);
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) main();
