import { describe, expect, it } from "vitest";
import { pageWithinLoadedResult } from "@/lib/list-pagination";

describe("paged list refresh", () => {
  it("does not reset page two while its replacement query is loading", () => {
    expect(pageWithinLoadedResult(2, 0, false)).toBe(2);
  });

  it("keeps a valid loaded page and clamps only after a successful result", () => {
    expect(pageWithinLoadedResult(2, 2, true)).toBe(2);
    expect(pageWithinLoadedResult(3, 2, true)).toBe(2);
    expect(pageWithinLoadedResult(2, 0, true)).toBe(1);
  });
});
