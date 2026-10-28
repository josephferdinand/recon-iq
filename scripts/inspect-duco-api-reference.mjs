// Read-only inspection of links observed in the official September release and Swagger UI.
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
const urls = [
  "https://app.aidp.du.co/api/v3/docs-json",
  "https://support.du.co/hc/en-us/articles/33771918709789-Duco-reporting-database-schema-ERD",
  "https://support.du.co/hc/en-us/articles/33724975896989-Duco-reporting-database-schemas",
  "https://support.du.co/api/v2/help_center/en-us/articles/33771918709789.json",
  "https://support.du.co/api/v2/help_center/en-us/articles/33724975896989.json",
];
const calls = [];
let apiReference = null;
for (const url of urls) {
  await new Promise((done) => setTimeout(done, 400));
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  const body = await response.text();
  calls.push({ url, final_url: response.url, status: response.status, content_type: response.headers.get("content-type"), visited_at: new Date().toISOString(), sha256: createHash("sha256").update(body).digest("hex") });
  if (url.endsWith("docs-json") && response.ok) {
    const spec = JSON.parse(body);
    const operations = Object.entries(spec.paths).flatMap(([path, item]) =>
      Object.entries(item).filter(([method]) => ["get", "post", "put", "patch", "delete"].includes(method))
        .map(([method, operation]) => ({ method, path, tags: operation.tags ?? [], operation_id: operation.operationId, response_codes: Object.keys(operation.responses ?? {}), has_request_body: Boolean(operation.requestBody), has_security: Boolean(operation.security?.length || spec.security?.length) })),
    );
    apiReference = { openapi: spec.openapi, version: spec.info.version, path_count: Object.keys(spec.paths).length, operation_count: operations.length, schema_count: Object.keys(spec.components?.schemas ?? {}).length, tags: [...new Set(operations.flatMap((operation) => operation.tags))], security_schemes: Object.keys(spec.components?.securitySchemes ?? {}), operations };
  }
}
const output = "docs/research/DUCO_API_BRANCH_SUPPLEMENT_2026-10-02.json";
await writeFile(output, JSON.stringify({ owner: "Helmholtz — Enterprise API documentation preparation", calls, api_reference: apiReference, access_boundary: "No login, challenge bypass, API execution or downloaded customer images. Cached web retrieval of reporting-schema article is distinct from fresh HTTP status recorded here." }, null, 2) + "\n");
console.log(JSON.stringify({ output, calls, api_reference: apiReference && { ...apiReference, operations: undefined } }, null, 2));
