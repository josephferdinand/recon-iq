import path from "node:path";
import { describe, expect, it } from "vitest";

import { assessOwnerTestReadiness, requiredCheckIds } from "../scripts/owner-test-readiness.mjs";

const root = path.resolve(".");

describe("owner test readiness", () => {
  it("reports the base public/API/RLS gates without disclosing credential values", () => {
    const report = assessOwnerTestReadiness({
      root,
      environment: { FVI_E2E_BASE_URL: "https://dev.app.reconiq.example" },
      fileExists: (candidate) => candidate.includes("SUPABASE_DEV_"),
    });

    const checks = Object.fromEntries(report.checks.map((check) => [check.id, check]));
    expect(checks["public-browser"].state).toBe("PASS");
    expect(checks["public-api"].state).toBe("PASS");
    expect(checks["dev-live-rls"].state).toBe("PASS");
    expect(checks["authenticated-screens"].state).toBe("BLOCKED");
    expect(JSON.stringify(report)).not.toMatch(/eyJ|service.role|anon.key/iu);
  });

  it("proves the full harness ready when every explicit owner-session gate exists", () => {
    const environment: Record<string, string> = {
      FVI_E2E_BASE_URL: "https://dev.app.reconiq.example",
      FVI_OWNER_STORAGE_STATE: "owner-state.json",
      FVI_RUN_AUTHENTICATED_SCREEN_MATRIX: "YES",
      FVI_ALLOW_OWNER_UPLOAD: "YES",
      FVI_E2E_TENANT_SLUG: "test-tenant",
      FVI_E2E_SOLUTION_SLUG: "banking",
      FVI_E2E_SUPPORT_CATEGORY: "reconciliation",
      FVI_E2E_SUPPORT_ARTICLE: "quickstart",
      FVI_E2E_DOCUMENT_ID: "document-id",
      FVI_E2E_KB_ARTICLE_ID: "article-id",
      FVI_E2E_REGULATORY_INSTALL_ID: "install-id",
      FVI_E2E_PLATFORM_TENANT_ID: "tenant-id",
      FVI_E2E_MARKETING_LEAD_ID: "lead-id",
      FVI_E2E_DOC_PATH: "security/audit-trail",
    };
    const report = assessOwnerTestReadiness({ root, environment, fileExists: () => true });
    const required = requiredCheckIds("full");

    expect(
      report.checks.filter((check) => required.has(check.id)).every((check) => check.state === "PASS"),
    ).toBe(true);
  });

  it("fails the base target gate for a non-FVI or non-HTTPS URL", () => {
    const report = assessOwnerTestReadiness({
      root,
      environment: { FVI_E2E_BASE_URL: "http://hostile.example" },
      fileExists: () => true,
    });

    expect(report.checks.find((check) => check.id === "public-browser")?.state).toBe("BLOCKED");
  });
});
