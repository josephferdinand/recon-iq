import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("shared card vertical rhythm", () => {
  it("gives standalone card content full padding", () => {
    const card = readFileSync("src/components/ui/card.tsx", "utf8");
    expect(card).toContain('data-slot="card-content" className={cn("p-6"');
    expect(card).not.toContain('className={cn("p-6 pt-0"');
  });

  it("removes top padding only after a structured card header", () => {
    const css = readFileSync("src/styles.css", "utf8");
    expect(css).toContain('[data-slot="card-header"] + [data-slot="card-content"]');
    expect(css).toContain("padding-top: 0;");
  });
});
