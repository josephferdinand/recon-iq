import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_HEADERS = [
  "strict-transport-security",
  "content-security-policy",
  "x-content-type-options",
  "x-frame-options",
  "referrer-policy",
  "permissions-policy",
];

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const candidate = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(candidate) : [candidate];
  });
}

export function docsRoutes(buildRoot) {
  return walk(buildRoot)
    .filter((file) => path.basename(file) === "index.html")
    .map((file) => {
      const directory = path.relative(buildRoot, path.dirname(file)).replaceAll("\\", "/");
      return directory === "" ? "/" : `/${directory}/`;
    })
    .sort();
}

export function isAllowedDocsTarget(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "docs.reconiq.example" || url.hostname.endsWith(".fvi-docs.pages.dev"))
    );
  } catch {
    return false;
  }
}

async function main() {
  const baseUrl = process.env.FVI_DOCS_BASE_URL?.replace(/\/$/u, "") ?? "";
  if (!isAllowedDocsTarget(baseUrl)) {
    throw new Error("FVI_DOCS_BASE_URL must be the FVI docs custom domain or its Pages preview");
  }

  const buildRoot = path.resolve("docs-docusaurus", "build");
  const routes = docsRoutes(buildRoot);
  const failures = [];
  const timings = [];
  let cursor = 0;

  async function worker() {
    while (cursor < routes.length) {
      const route = routes[cursor++];
      const started = performance.now();
      try {
        const response = await fetch(`${baseUrl}${route}`, {
          redirect: "follow",
          signal: AbortSignal.timeout(20_000),
        });
        const body = await response.text();
        timings.push(performance.now() - started);
        if (response.status !== 200) failures.push(`${route} status=${response.status}`);
        if (/Page Not Found|We could not find what you were looking for/u.test(body)) {
          failures.push(`${route} rendered_not_found`);
        }
        const missingHeaders = REQUIRED_HEADERS.filter((header) => !response.headers.get(header));
        if (missingHeaders.length > 0) {
          failures.push(`${route} missing_headers=${missingHeaders.join(",")}`);
        }
      } catch (error) {
        timings.push(performance.now() - started);
        failures.push(`${route} request_error=${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(8, routes.length) }, () => worker()));
  const orderedTimings = timings.sort((left, right) => left - right);
  const p95Index = Math.min(
    orderedTimings.length - 1,
    Math.max(0, Math.ceil(orderedTimings.length * 0.95) - 1),
  );

  console.log(`docs_target=${baseUrl}`);
  console.log(`docs_routes=${routes.length}`);
  console.log(`security_header_assertions=${routes.length * REQUIRED_HEADERS.length}`);
  console.log(`response_p95_ms=${Math.round(orderedTimings[p95Index] ?? 0)}`);
  console.log(`failures=${failures.length}`);
  if (failures.length > 0) {
    for (const failure of failures.slice(0, 20)) console.error(`FAIL ${failure}`);
    throw new Error(`Deployed documentation verification failed for ${failures.length} assertion set(s)`);
  }
  console.log("PASS deployed_documentation");
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) await main();
