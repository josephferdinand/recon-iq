import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("Data Prep lifecycle UI contract", () => {
  it("loads every lifecycle field required to render approval and promotion controls", async () => {
    const source = await readFile(
      fileURLToPath(new URL("../src/lib/data-prep.functions.ts", import.meta.url)),
      "utf8",
    );
    const listProjection = source.match(/export const listPipelines[\s\S]*?\.order\(/u)?.[0] ?? "";

    for (const field of [
      "lifecycle_state",
      "parent_pipeline_id",
      "promotion_status",
      "promotion_requested_at",
      "promotion_requested_by",
    ]) {
      expect(listProjection).toContain(field);
    }
  });
});
