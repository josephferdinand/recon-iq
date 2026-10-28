import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("keyboard shortcuts dialog layout", () => {
  it("keeps the header fixed while the shortcut list scrolls inside the viewport", async () => {
    const source = await readFile("src/components/keyboard-shortcuts-dialog.tsx", "utf8");

    expect(source).toContain("max-h-[calc(100dvh_-_1rem)]");
    expect(source).toContain("w-[calc(100vw_-_1rem)] max-w-[42rem]");
    expect(source).toContain("grid-rows-[auto_minmax(0,1fr)]");
    expect(source).toContain("overflow-hidden p-0");
    expect(source).toContain('role="region"');
    expect(source).toContain("aria-label={`${title} list`}");
    expect(source).toContain("tabIndex={0}");
    expect(source).toContain("overflow-x-hidden overflow-y-auto overscroll-contain");
    expect(source).toContain("shrink-0 border-b");
  });
});
