import { describe, expect, it } from "vitest";
import { formatReconRunId } from "../src/lib/recon-run-id";

describe("formatReconRunId", () => {
  it("uppercases persisted human-readable run IDs", () => {
    expect(formatReconRunId("R-20260923-abcdef12", "unused")).toBe("R-20260923-ABCDEF12");
  });

  it("uses the full UUID when a historical run has no public ID", () => {
    expect(formatReconRunId(null, "12345678-abcd-4aef-8123-abcdef012345")).toBe(
      "R-12345678ABCD4AEF8123ABCDEF012345",
    );
  });
});
