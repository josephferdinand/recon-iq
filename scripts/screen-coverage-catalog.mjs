import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LAYOUT_ROUTE_IDS = new Set([
  "/_authenticated",
  "/_authenticated/$slug",
  "/developers",
  "/mkt-admin",
  "/mkt-admin/brand",
  "/support",
]);

const PARAMETER_ENVIRONMENTS = [
  { route: /^\/_authenticated\/\$slug/u, parameter: "slug", environment: "FVI_E2E_TENANT_SLUG" },
  { route: /^\/t\/\$slug/u, parameter: "slug", environment: "FVI_E2E_TENANT_SLUG" },
  { route: /^\/solutions\/\$slug/u, parameter: "slug", environment: "FVI_E2E_SOLUTION_SLUG" },
  {
    route: /^\/support\/\$category/u,
    parameter: "category",
    environment: "FVI_E2E_SUPPORT_CATEGORY",
  },
  {
    route: /^\/support\/\$category\/\$article/u,
    parameter: "article",
    environment: "FVI_E2E_SUPPORT_ARTICLE",
  },
  {
    route: /\/aidp\/annotate\/\$documentId$/u,
    parameter: "documentId",
    environment: "FVI_E2E_DOCUMENT_ID",
  },
  { route: /\/kb\/\$articleId$/u, parameter: "articleId", environment: "FVI_E2E_KB_ARTICLE_ID" },
  {
    route: /\/regulatory\/\$installId$/u,
    parameter: "installId",
    environment: "FVI_E2E_REGULATORY_INSTALL_ID",
  },
  {
    route: /\/platform\/tenants\/\$id$/u,
    parameter: "id",
    environment: "FVI_E2E_PLATFORM_TENANT_ID",
  },
  {
    route: /\/mkt-admin\/leads\/\$leadId$/u,
    parameter: "leadId",
    environment: "FVI_E2E_MARKETING_LEAD_ID",
  },
  { route: /^\/_authenticated\/docs\/\$$/u, parameter: "$", environment: "FVI_E2E_DOC_PATH" },
];

export const DEFAULT_SCREEN_FIXTURES = Object.freeze({
  FVI_E2E_DOC_PATH: "admin-guides/01_rbac_sod",
  FVI_E2E_SOLUTION_SLUG: "cash-reconciliation",
  FVI_E2E_SUPPORT_ARTICLE: "what-is-fvi",
  FVI_E2E_SUPPORT_CATEGORY: "getting-started",
});

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(entryPath) : [entryPath];
  });
}

function normalizePath(routeId) {
  const withoutGroup = routeId.replace(/^\/_authenticated(?=\/|$)/u, "");
  if (withoutGroup === "" || withoutGroup === "/") return "/";
  return withoutGroup.endsWith("/") ? withoutGroup.slice(0, -1) : withoutGroup;
}

function classifyArea(routeId) {
  if (routeId === "/mfa-challenge") return "authentication";
  if (routeId.startsWith("/mkt-admin")) return "marketing-admin";
  if (routeId.startsWith("/_authenticated/$slug/workspace")) return "workspace";
  if (routeId.startsWith("/_authenticated/$slug/tenant")) return "tenant-admin";
  if (routeId.startsWith("/_authenticated/$slug")) return "tenant";
  if (routeId.startsWith("/_authenticated/platform")) return "platform-admin";
  if (routeId.startsWith("/_authenticated/security-appendix")) return "security-appendix";
  if (routeId.startsWith("/_authenticated/hub")) return "platform-hub";
  if (routeId.startsWith("/_authenticated/docs")) return "documentation";
  if (routeId.startsWith("/_authenticated/profile")) return "profile";
  if (routeId.startsWith("/_authenticated")) return "authenticated";
  return "public";
}

function requiredParameters(routeId) {
  const parameters = [...routeId.matchAll(/\$([A-Za-z0-9_]+|$)(?=\/|$)/gu)].map(
    (match) => match[1] || "$",
  );

  return parameters.map((parameter) => {
    const mapping = PARAMETER_ENVIRONMENTS.find(
      (candidate) => candidate.parameter === parameter && candidate.route.test(routeId),
    );
    if (!mapping) {
      throw new Error(`No fixture environment mapping for ${parameter} in ${routeId}`);
    }
    return { parameter, environment: mapping.environment };
  });
}

export function discoverUiScreens(root = process.cwd()) {
  const routesDirectory = path.join(root, "src", "routes");
  const screens = [];

  for (const file of walk(routesDirectory).filter((candidate) => candidate.endsWith(".tsx"))) {
    const source = readFileSync(file, "utf8");
    const match = source.match(/createFileRoute\(\s*(["'])([^"']+)\1\s*\)/u);
    if (!match) continue;

    const routeId = match[2];
    if (LAYOUT_ROUTE_IDS.has(routeId)) continue;

    const area = classifyArea(routeId);
    screens.push({
      sourceFile: path.relative(root, file).replaceAll("\\", "/"),
      routeId,
      pathTemplate: normalizePath(routeId),
      area,
      requiresAuth:
        routeId === "/mfa-challenge" ||
        routeId.startsWith("/_authenticated") ||
        routeId.startsWith("/mkt-admin"),
      mutation: "none",
      parameters: requiredParameters(routeId),
    });
  }

  return screens.sort((left, right) => left.pathTemplate.localeCompare(right.pathTemplate, "en"));
}

export function resolveScreenPath(screen, environment = process.env) {
  let resolvedPath = screen.pathTemplate;
  const missing = [];

  for (const parameter of screen.parameters) {
    const value =
      environment[parameter.environment]?.trim() ?? DEFAULT_SCREEN_FIXTURES[parameter.environment];
    if (!value) {
      missing.push(parameter.environment);
      continue;
    }

    const encoded =
      parameter.parameter === "$"
        ? value.split("/").map(encodeURIComponent).join("/")
        : encodeURIComponent(value);
    const token = parameter.parameter === "$" ? "$" : `$${parameter.parameter}`;
    resolvedPath = resolvedPath.replace(token, encoded);
  }

  return { path: missing.length === 0 ? resolvedPath : null, missing };
}

export function summarizeScreenCoverage(screens, environment = process.env) {
  const byArea = Object.fromEntries(
    [...new Set(screens.map((screen) => screen.area))]
      .sort()
      .map((area) => [area, screens.filter((screen) => screen.area === area).length]),
  );
  const resolvable = screens.filter(
    (screen) => resolveScreenPath(screen, environment).missing.length === 0,
  ).length;

  return {
    total: screens.length,
    public: screens.filter((screen) => !screen.requiresAuth).length,
    authenticated: screens.filter((screen) => screen.requiresAuth).length,
    resolvable,
    fixtureBlocked: screens.length - resolvable,
    byArea,
  };
}

function main() {
  const screens = discoverUiScreens();
  const output = process.argv.includes("--summary")
    ? summarizeScreenCoverage(screens)
    : { summary: summarizeScreenCoverage(screens), screens };
  console.log(JSON.stringify(output, null, 2));
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) main();
