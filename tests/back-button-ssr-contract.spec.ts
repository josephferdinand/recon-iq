import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

describe("BackButton SSR contract", () => {
  it("renders one stable link and defers history selection to the click handler", async () => {
    const source = await readFile(
      new URL("../src/components/back-button.tsx", import.meta.url),
      "utf8",
    );
    expect(source).not.toContain('typeof window !== "undefined"');
    expect(source).not.toMatch(/if \(hasHistory\)[\s\S]*<button/iu);
    expect(source).toContain("window.history.length > 1");
    expect(source).toContain("event.preventDefault()");
    expect(source).toContain("router.history.back()");
    expect(source).toContain("event.metaKey");
    expect(source).toContain("event.ctrlKey");
  });
});
