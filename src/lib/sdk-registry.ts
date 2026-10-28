// SDK registry — surfaces generated TypeScript SDKs in the developer portal.
// Bundles README, QUICKSTART, and the generated client source as raw text so
// they render inline without extra network calls.

const rawSdk = import.meta.glob("/sdks/typescript/**/*.{ts,md,json}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export const SDK_VERSIONS = ["v4.0", "v3.0"] as const;
export type SdkVersion = (typeof SDK_VERSIONS)[number];
export const DEFAULT_SDK_VERSION: SdkVersion = "v4.0";

export type SdkFile = { path: string; label: string; language: "typescript" | "markdown" | "json"; content: string };

export type SdkPackage = {
  version: SdkVersion;
  npmName: string;
  npmVersion: string;
  status: "latest" | "archived";
  releaseDate: string;
  supportPolicy: string;
  installCommands: { label: string; cmd: string }[];
  operationCount: number;
  tagCount: number;
  files: SdkFile[];
  readme: string;
  quickstart: string;
};

function readOr(path: string, fallback = ""): string {
  return rawSdk[path] ?? fallback;
}

function classifyLanguage(path: string): SdkFile["language"] {
  if (path.endsWith(".md")) return "markdown";
  if (path.endsWith(".json")) return "json";
  return "typescript";
}

function filesForVersion(version: SdkVersion): SdkFile[] {
  const prefix = `/sdks/typescript/${version}/`;
  return Object.keys(rawSdk)
    .filter((p) => p.startsWith(prefix))
    .sort()
    .map((path) => ({
      path: path.slice(prefix.length),
      label: path.slice(prefix.length),
      language: classifyLanguage(path),
      content: rawSdk[path],
    }));
}

function countOps(indexTs: string): { ops: number; tags: number } {
  const ops = (indexTs.match(/\n\s*async\s+[a-zA-Z0-9_]+\s*\(/g) ?? []).length;
  const tags = (indexTs.match(/\nexport class [A-Z][A-Za-z0-9]+Api\b/g) ?? []).length;
  return { ops, tags };
}

function buildPackage(version: SdkVersion): SdkPackage {
  const base = `/sdks/typescript/${version}/`;
  const readme = readOr(base + "README.md");
  const quickstart = readOr(base + "QUICKSTART.md");
  const pkgJson = readOr(base + "package.json");
  const indexTs = readOr(base + "src/index.ts");
  const { ops, tags } = countOps(indexTs);
  let npmVersion = version.replace(/^v/, "") + ".0";
  try { npmVersion = (JSON.parse(pkgJson) as { version?: string }).version ?? npmVersion; } catch { /* noop */ }

  return {
    version,
    npmName: "@reconiq/sdk",
    npmVersion,
    status: version === "v4.0" ? "latest" : "archived",
    releaseDate: version === "v4.0" ? "2026-Q2" : "2025-Q4",
    supportPolicy:
      version === "v4.0"
        ? "Current release. New integrations MUST target v4."
        : "Archived. Read-only bug fixes; sunsets 2026-Q4. Migrate to v4.",
    installCommands: [
      { label: "npm", cmd: `npm install ${"@reconiq/sdk"}@${npmVersion}` },
      { label: "pnpm", cmd: `pnpm add ${"@reconiq/sdk"}@${npmVersion}` },
      { label: "bun", cmd: `bun add ${"@reconiq/sdk"}@${npmVersion}` },
      { label: "yarn", cmd: `yarn add ${"@reconiq/sdk"}@${npmVersion}` },
    ],
    operationCount: ops,
    tagCount: tags,
    files: filesForVersion(version),
    readme,
    quickstart,
  };
}

export const SDK_PACKAGES: Record<SdkVersion, SdkPackage> = {
  "v4.0": buildPackage("v4.0"),
  "v3.0": buildPackage("v3.0"),
};

export function isSdkVersion(v: string | undefined): v is SdkVersion {
  return !!v && (SDK_VERSIONS as readonly string[]).includes(v);
}

export const QUICKSTART_SNIPPETS: {
  id: string;
  title: string;
  description: string;
  versions: SdkVersion[];
  code: string;
}[] = [
  {
    id: "auth",
    title: "Authenticate",
    description: "Create a client with a Supabase-issued JWT bearer.",
    versions: ["v4.0", "v3.0"],
    code: `import { FviClient } from "@reconiq/sdk";

const fvi = new FviClient({
  token: process.env.FVI_TOKEN!,
  timeoutMs: 15_000,
});

const session = await fvi.auth.getSession();`,
  },
  {
    id: "tenants",
    title: "List tenants",
    description: "Every read is tenant-scoped by RLS.",
    versions: ["v4.0", "v3.0"],
    code: `const tenants = await fvi.tenants.getTenants();
console.log(\`\${tenants.length} tenant(s) visible\`);`,
  },
  {
    id: "recon",
    title: "Inspect a recon run",
    description: "Fetch matches and open breaks for a single run.",
    versions: ["v4.0", "v3.0"],
    code: `const [run] = await fvi.reconciliation.getReconRuns({ tenant_id });
const matches = await fvi.reconciliation.getReconRunsByIdMatches({ id: run.id });
const breaks  = await fvi.exceptions.getReconRunsByIdBreaks({ id: run.id });`,
  },
  {
    id: "soc2",
    title: "Generate a SOC 2 bundle",
    description: "Returns a signed URL, TTL 5–120 minutes.",
    versions: ["v4.0"],
    code: `const bundle = await fvi.exports.postExportsSoc2Bundle();
// { signed_url, expires_at }`,
  },
  {
    id: "webhook",
    title: "Verify an inbound webhook",
    description: "Timing-safe HMAC comparison — never string equality.",
    versions: ["v4.0"],
    code: `import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyFviWebhook(body: string, sig: string, secret: string) {
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const a = Buffer.from(sig); const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}`,
  },
  {
    id: "errors",
    title: "Handle API errors",
    description: "FviApiError carries status + parsed body.",
    versions: ["v4.0", "v3.0"],
    code: `import { FviApiError } from "@reconiq/sdk";

try { await fvi.tenants.getTenants(); }
catch (err) {
  if (err instanceof FviApiError) console.error(err.status, err.body);
  else throw err;
}`,
  },
];
