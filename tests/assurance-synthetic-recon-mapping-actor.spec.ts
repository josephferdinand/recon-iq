import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("scripts/map-assurance-synthetic-reconciliations.mjs", "utf8");

describe("synthetic Assurance owner mapping actor contract", () => {
  it("requires a separate executor credential, never maker/checker credentials", () => {
    expect(source).toContain('path.basename(credentialPath) !== "FVI-QA-Access-PROD-executor-20260925.cred"');
    expect(source).not.toContain('path.basename(credentialPath) !== "FVI-QA-Access-PROD-maker-20260925.cred"');
    expect(source).toContain("signedIn.user?.id !== executorId");
    expect(source).toContain("do not reuse maker/checker credentials");
  });

  it("still fails closed until hosted owner schema, RPC and migration are present", () => {
    expect(source).toContain("if (!state.owner_schema || !state.admin_rpc || !state.ledgered)");
    expect(source).toContain("no mapping write attempted");
    expect(source).toContain("if (map.size !== 20)");
  });
});
