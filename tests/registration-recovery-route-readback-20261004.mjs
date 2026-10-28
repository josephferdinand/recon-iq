import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
const output = "./LOCAL_USER/AppData/Local/Temp/fvi-codex-docs-release-20260930/output/faraday-registration-acceptance-20261004";
const routes = [["PROD", "https://app.reconiq.example"], ["DEV", "https://dev.app.reconiq.example"]];
const results = await Promise.all(routes.map(async ([environment, origin]) => {
  const url = `${origin}/request-invite`;
  try {
    const response = await fetch(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(20_000), headers: { accept: "text/html" } });
    const location = response.headers.get("location");
    const redirect = location ? new URL(location, origin) : null;
    const body = await response.text();
    return {
      environment, at: new Date().toISOString(), url, status: response.status,
      redirectPath: redirect?.pathname, redirectSameOrigin: redirect ? redirect.origin === origin : null,
      contentType: response.headers.get("content-type"),
      bodySha256: createHash("sha256").update(body).digest("hex"),
      expectedFormMarkers: {
        submitAction: body.includes("Verify email and request access"),
        nameField: body.includes("signup-name"), emailField: body.includes("signup-email"),
      },
      evidenceTier: "HTTP_READ_ONLY_NOT_BROWSER_WORKFLOW", accountOrEmailWrites: false,
    };
  } catch (error) {
    return { environment, at: new Date().toISOString(), url, transport: ["TimeoutError", "AbortError"].includes(error.name) ? "TIMEOUT" : "READ_FAILED", evidenceTier: "HTTP_READ_ONLY_NOT_BROWSER_WORKFLOW", accountOrEmailWrites: false };
  }
}));
const receipt = { at: new Date().toISOString(), results, redirectsFollowed: false, rawBodiesOrCookiesSaved: false, hostedWorkflowAcceptance: "OPEN_REQUIRES_PARENT_RELEASE_AND_BOUNDED_QA_ACK" };
await fs.mkdir(output, { recursive: true });
const file = path.join(output, `read-only-route-readback-${new Date().toISOString().replace(/[^0-9]/g, "")}.json`);
await fs.writeFile(file, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ file, results }));
