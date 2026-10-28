import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { docsRoutes, isAllowedDocsTarget } from "../scripts/verify-deployed-docs.mjs";

describe("deployed documentation verifier", () => {
  it("derives canonical routes only from built index files", () => {
    const root = mkdtempSync(path.join(tmpdir(), "fvi-docs-routes-"));
    mkdirSync(path.join(root, "security", "audit-trail"), { recursive: true });
    writeFileSync(path.join(root, "index.html"), "home");
    writeFileSync(path.join(root, "security", "audit-trail", "index.html"), "audit");
    writeFileSync(path.join(root, "404.html"), "not found");

    expect(docsRoutes(root)).toEqual(["/", "/security/audit-trail/"]);
  });

  it("allows only the FVI docs custom domain and its Pages previews", () => {
    expect(isAllowedDocsTarget("https://docs.reconiq.example")).toBe(true);
    expect(isAllowedDocsTarget("https://YOUR_PROJECT.pages.dev")).toBe(true);
    expect(isAllowedDocsTarget("http://docs.reconiq.example")).toBe(false);
    expect(isAllowedDocsTarget("https://hostile.example")).toBe(false);
  });
});
