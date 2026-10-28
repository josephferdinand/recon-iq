// Prepare a source-navigation baseline; this creates no screenshots or authentication state.
import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
const permissions = await readFile("src/lib/page-permissions.ts", "utf8");
const platform = await readFile("src/routes/_authenticated/platform.tsx", "utf8");
function extract(source, declaration, scope, sourceFile) {
  const array = source.match(new RegExp(`${declaration}\\[([\\s\\S]*?)\\n\\];`, "u"))?.[1];
  if (!array) throw new Error(`Navigation declaration missing: ${scope}`);
  return [...array.matchAll(/\bkey:\s*"([^"]+)"/gu)].map((match) => ({ scope, page_key: match[1], source_file: sourceFile, state: "pending_documentation_phase_own_qa_context", captures: [] }));
}
const entries = [
  ...extract(permissions, "export const WORKSPACE_PAGES: PageDef\\[\\] = ", "workspace", "src/lib/page-permissions.ts"),
  ...extract(permissions, "export const TENANT_PAGES: PageDef\\[\\] = ", "tenant", "src/lib/page-permissions.ts"),
  ...extract(platform, "const PAGES: RailItem\\[\\] = ", "platform", "src/routes/_authenticated/platform.tsx"),
];
const authPath = "output/playwright/helmholtz-api-20261002/fvi-prod-auth.png";
const authBytes = await readFile(authPath);
const authStat = await stat(authPath);
const manifest = {
  owner: "Helmholtz — Enterprise API documentation preparation",
  state: "preparation_only_authenticated_capture_requirement_open",
  scope: "Source navigation baseline; dialogs, subtabs, workflow outcomes and denial/error states still require separate capture inventory",
  production_origin: "https://app.reconiq.example",
  baseline_provenance: "Owner/Primary freshly verified 2026-10-02: app72a7f088, PROD431, DEV409; not independently provider-read by Helmholtz",
  authenticated_context: "No Helmholtz-owned QA context assigned in this preparation; no teammate sessions borrowed",
  actual_captures: [{ scope: "anonymous_auth", url: "https://app.reconiq.example/auth", path: authPath, captured_at: authStat.mtime.toISOString(), sha256: createHash("sha256").update(authBytes).digest("hex"), visually_inspected: true, evidence: "Genuine PROD sign-in rendering only; no entered credentials or authenticated feature acceptance" }],
  counts: Object.fromEntries(["workspace", "tenant", "platform"].map((scope) => [scope, entries.filter((entry) => entry.scope === scope).length])),
  entries,
  capture_rules: ["Use assigned own QA context and real MFA; authorized ordinary own-QA refresh/relogin only", "Resolve actual authorized resource and tenant routes; source navigation does not prove reachability", "Capture actual FVI UI with original branding and authorized synthetic records; no mocked images or copied customer images", "Keep secret/token/password/MFA material out of screenshots and public logs", "Retain native-auth/SSO/SCIM/Alpic/retention/suggest and transport holds", "Do not substitute localhost or source rendering for PROD/DEV/UAT acceptance"],
};
const output = "docs/evidence/FVI_API_DOCS_SCREEN_CAPTURE_MANIFEST_2026-10-02.json";
await writeFile(output, JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({ output, counts: manifest.counts, total_pending_navigation_captures: entries.length, actual_capture_count: manifest.actual_captures.length }));
