import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

describe("homepage reduced-motion SSR contract", () => {
  it("defers the OS preference until after the first client render", async () => {
    const source = await readFile(new URL("../src/routes/index.tsx", import.meta.url), "utf8");
    expect(source).toContain("function useHydrationSafeReducedMotion()");
    expect(source).toContain("return hydrated ? Boolean(preference) : false;");
    expect(source.match(/const reduce = useHydrationSafeReducedMotion\(\);/gu)).toHaveLength(9);
    expect(source.match(/const reduce = useReducedMotion\(\);/gu)).toBeNull();
  });

  it("keeps CursorSpotlight DOM stable while disabling pointer tracking", async () => {
    const source = await readFile(new URL("../src/routes/index.tsx", import.meta.url), "utf8");
    const spotlight = source.slice(
      source.indexOf("function CursorSpotlight()"),
      source.indexOf("function ScrollBeam()"),
    );
    expect(spotlight).toContain("if (reduce) return;");
    expect(spotlight).not.toContain("if (reduce) return null;");
    expect(spotlight).toContain("<motion.div");
  });
});
