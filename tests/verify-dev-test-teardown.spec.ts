import { describe, expect, it } from "vitest";

import { evaluateTeardownAudit } from "../scripts/verify-dev-test-teardown.mjs";

describe("DEV live-test teardown evidence", () => {
  it("passes only when every created tenant has a purge event and zero residue", () => {
    expect(
      evaluateTeardownAudit([
        { tenant_id: "tenant-a", event: "create" },
        { tenant_id: "tenant-a", event: "purge" },
        { tenant_id: "tenant-b", event: "create" },
        { tenant_id: "tenant-b", event: "purge" },
      ]),
    ).toMatchObject({ pass: true, created: 2, purged: 2, purgeFailed: 0 });
  });

  it("fails for a missing purge or surviving tenant row", () => {
    const report = evaluateTeardownAudit(
      [
        { tenant_id: "tenant-a", event: "create" },
        { tenant_id: "tenant-b", event: "create" },
        { tenant_id: "tenant-b", event: "purge" },
      ],
      ["tenant-b"],
    );

    expect(report.pass).toBe(false);
    expect(report.missingPurge).toEqual(["tenant-a"]);
    expect(report.residue).toEqual(["tenant-b"]);
  });

  it("fails closed when the database records a rejected purge", () => {
    expect(
      evaluateTeardownAudit([
        { tenant_id: "tenant-a", event: "create" },
        { tenant_id: "tenant-a", event: "purge_failed" },
      ]),
    ).toMatchObject({ pass: false, purgeFailed: 1 });
  });
});
