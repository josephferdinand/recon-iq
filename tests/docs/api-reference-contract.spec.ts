import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

type OpenApi = {
  paths: Record<string, Record<string, any>>;
  components: {
    securitySchemes: Record<string, unknown>;
    schemas: Record<string, unknown>;
    parameters: Record<string, unknown>;
  };
};

const root = process.cwd();
const openApiPath = join(root, "docs/openapi/fvi-openapi.yaml");
const openApi = load(readFileSync(openApiPath, "utf8")) as OpenApi;
const methods = ["get", "post", "put", "patch", "delete"] as const;
const routeRoot = join(root, "src/routes/api");

function localRefs(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(localRefs);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) =>
    key === "$ref" && typeof child === "string" ? [child] : localRefs(child),
  );
}

type SourceRoute = { path: string; file: string; methods: Set<string> };

function filesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

function sourceRoutes(): SourceRoute[] {
  return filesUnder(routeRoot)
    .filter((path) => path.endsWith(".ts"))
    .flatMap((file) => {
      const source = readFileSync(file, "utf8");
      const routePath = source.match(/createFileRoute\(["']([^"']+)["']\)/u)?.[1];
      if (!routePath) return [];
      const handlers = new Set(
        [...source.matchAll(/\b(GET|POST|PUT|PATCH|DELETE)\s*:\s*(?:async\s*)?\(/gu)]
          .map((match) => match[1].toLowerCase()),
      );
      const normalizedPath = routePath.replace(/\$([A-Za-z][A-Za-z0-9]*)/gu, "{$1}");
      return [{ path: normalizedPath, file, methods: handlers }];
    });
}

const routes = sourceRoutes();

function sourceForDocumentedPath(path: string, method: string) {
  return routes.find((route) => {
    if (!route.methods.has(method)) return false;
    if (route.path === path) return true;
    if (!route.path.endsWith("/$")) return false;
    const prefix = route.path.slice(0, -1);
    return path.startsWith(prefix) && path.length > prefix.length;
  });
}

describe("FVI API reference matches source HTTP routes", () => {
  it("parses as OpenAPI 3.1 and has unique operation IDs and valid security references", () => {
    expect(openApi.paths).toBeTruthy();
    const operationIds = new Set<string>();
    for (const [path, pathItem] of Object.entries(openApi.paths)) {
      expect(path.startsWith("/api/")).toBe(true);
      for (const method of methods) {
        const operation = pathItem[method];
        if (!operation) continue;
        expect(typeof operation.operationId).toBe("string");
        expect(operationIds.has(operation.operationId)).toBe(false);
        operationIds.add(operation.operationId);
        for (const requirement of operation.security ?? []) {
          for (const scheme of Object.keys(requirement)) {
            expect(openApi.components.securitySchemes[scheme], `${method.toUpperCase()} ${path} uses unknown scheme ${scheme}`).toBeTruthy();
          }
        }
        expect(sourceForDocumentedPath(path, method), `No source route for ${method.toUpperCase()} ${path}`).toBeTruthy();
      }
    }
    expect(operationIds.size).toBeGreaterThan(40);
  });

  it("resolves all local component references used by documented operations", () => {
    const refs = localRefs(openApi.paths);
    for (const reference of refs) {
      const [kind, name] = reference.replace(/^#\/components\//u, "").split("/");
      const componentSet = (openApi.components as unknown as Record<string, Record<string, unknown>>)[kind];
      expect(componentSet?.[name], `Unresolved #/components/${kind}/${name}`).toBeTruthy();
    }
  });

  it("documents every tenant-v1 route method except preflight OPTIONS", () => {
    const documented = new Set<string>();
    for (const [path, pathItem] of Object.entries(openApi.paths)) {
      for (const method of methods) if (pathItem[method]) documented.add(`${method} ${path}`);
    }
    const missing = routes.flatMap((route) => {
      if (!route.path.startsWith("/api/v1/")) return [];
      return [...route.methods]
        .filter((method) => !documented.has(`${method} ${route.path}`))
        .map((method) => `${method.toUpperCase()} ${route.path} (${relative(root, route.file)})`);
    });
    expect(missing).toEqual([]);
  });

  it("declares tenant bearer auth and a required route scope for every /api/v1 operation", () => {
    for (const [path, pathItem] of Object.entries(openApi.paths)) {
      if (!path.startsWith("/api/v1/")) continue;
      for (const method of methods) {
        const operation = pathItem[method];
        if (!operation) continue;
        expect(operation.security, `${method.toUpperCase()} ${path} security`).toContainEqual({ tenantApiToken: [] });
        const requiredScope = operation["x-required-scope"];
        const scopeOptions = Array.isArray(requiredScope) ? requiredScope : [requiredScope];
        expect(scopeOptions.length, `${method.toUpperCase()} ${path} scope`).toBeGreaterThan(0);
        expect(scopeOptions.every((scope) => typeof scope === "string" && /^[a-z][a-z0-9-]*[.:][a-z][a-z0-9.-]*$/u.test(scope)), `${method.toUpperCase()} ${path} scope names`).toBe(true);
      }
    }
  });

  it("does not reintroduce known unsupported route families", () => {
    const documentedPaths = Object.keys(openApi.paths);
    for (const unsupported of [
      "/api/session",
      "/api/tenants",
      "/api/recon/runs",
      "/api/public/tenants",
      "/api/public/transactions",
      "/api/public/exceptions",
      "/api/public/rules",
      "/api/exports/audit",
      "/api/admin/audit",
      "/api/public/webhooks/subscriptions",
      "/api/public/graphql",
      "/api/public/mcp/sse",
    ]) {
      expect(documentedPaths.some((path) => path === unsupported || path.startsWith(`${unsupported}/`)), unsupported).toBe(false);
    }
    expect(openApi.servers).toBeUndefined();
  });

  it("resolves every internal API-reference link to a page", () => {
    const docsRoot = join(root, "docs-site/api-reference");
    const missing: string[] = [];
    for (const file of filesUnder(docsRoot).filter((path) => path.endsWith(".mdx"))) {
      const content = readFileSync(file, "utf8");
      for (const match of content.matchAll(/\]\((\/api-reference\/[^)#\s]+)(?:#[^)]+)?\)/gu)) {
        const target = match[1].replace(/^\/api-reference\//u, "");
        const page = target ? `${target.replace(/\/$/u, "")}.mdx` : "index.mdx";
        if (!existsSync(join(docsRoot, page))) missing.push(`${relative(root, file)} -> ${match[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("makes the quickstart, scenarios, and route reference discoverable from the landing page", () => {
    const landing = readFileSync(join(root, "docs-site/api-reference/index.mdx"), "utf8");
    for (const destination of ["quickstart", "scenarios", "overview", "platform", "tenant", "workspace"]) {
      expect(landing).toContain(`/api-reference/${destination}`);
    }
    expect(landing).toContain("not proof that a route");
    expect(landing).toContain("New issuance rejects legacy aliases");
  });

  it("keeps the Mintlify API sidebar ordered from quickstart to scenarios and categories", () => {
    const mintConfig = JSON.parse(readFileSync(join(root, "docs-site/mint.json"), "utf8")) as {
      navigation: Array<{ group: string; pages: string[] }>;
    };
    const pages = mintConfig.navigation.find((group) => group.group === "API Reference")?.pages ?? [];
    const required = [
      "api-reference/index",
      "api-reference/quickstart",
      "api-reference/scenarios",
      "api-reference/platform",
      "api-reference/tenant",
      "api-reference/workspace",
    ];
    expect(pages.slice(0, required.length)).toEqual(required);
    for (const page of pages) expect(existsSync(join(root, "docs-site", `${page}.mdx`)), page).toBe(true);
  });

  it("keeps the API-only visual theme wrapper balanced on core entry pages", () => {
    for (const page of [
      "index", "quickstart", "scenarios", "platform", "tenant", "workspace",
      "overview", "authentication", "pagination-idempotency", "maker-checker", "errors", "rate-limits",
    ]) {
      const content = readFileSync(join(root, `docs-site/api-reference/${page}.mdx`), "utf8");
      expect(content.match(/<div className="api-reference">/gu)?.length, page).toBe(1);
      expect(content.match(/<\/div>/gu)?.length, page).toBe(1);
    }
  });
});
