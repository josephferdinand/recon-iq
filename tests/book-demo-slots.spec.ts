import { describe, expect, it } from "vitest";

import { nextBusinessSlots } from "../src/routes/book-demo";

describe("book-demo deterministic slots", () => {
  it("uses the serialized UTC anchor and excludes weekends", () => {
    expect(nextBusinessSlots("2026-09-04").map((slot) => slot.date)).toEqual([
      "2026-09-07",
      "2026-09-08",
      "2026-09-09",
      "2026-09-10",
      "2026-09-11",
    ]);
  });
});
