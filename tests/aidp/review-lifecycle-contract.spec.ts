import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("AIDP review lifecycle contract", () => {
  it("keeps a prediction pending until every field is decided", async () => {
    const source = await readFile("src/lib/aidp-review.functions.ts", "utf8");
    expect(source).toContain("pending === 0");
    expect(source).toContain("requiredRejected > 0");
    expect(source).toContain("pending_fields: pending");
    expect(source).not.toContain('const newDecision = data.decision === "reject"');
    expect(source).toContain("Array.isArray(value) ? value[0] : value");
    expect(source).toContain("aidp_predictions: relation(row.aidp_predictions)");
  });

  it("requires reviewer authorization, completed field decisions, current outputs and audit before document approval", async () => {
    const source = await readFile("src/lib/aidp.functions.ts", "utf8");
    expect(source).toContain("Forbidden: AIDP reviewer role required");
    expect(source).toContain("Complete every pending AIDP field review before document approval");
    expect(source).toContain("Document approval requires reviewed current outputs");
    expect(source).toContain('action: "aidp.document.approve"');
    expect(source).toContain('.eq("status", "review").select("id").maybeSingle()');
  });
});
