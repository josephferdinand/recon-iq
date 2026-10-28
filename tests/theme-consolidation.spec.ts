import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  CHROMES,
  FVI_FACTORY_PRESET,
  PALETTES,
  THEME_CHROME_IDS,
  THEME_PALETTE_IDS,
  normalizeChromeId,
  normalizePaletteId,
  normalizeThemeMode,
} from "@/lib/theme-config";

describe("owner-approved theme consolidation", () => {
  it("exposes exactly four canvas palettes in the approved order", () => {
    expect(THEME_PALETTE_IDS).toEqual(["porcelain", "cloudy-mist", "arctic-frost", "coffee-warm-sand"]);
    expect(PALETTES.map((item) => item.name)).toEqual(["Porcelain", "Cloudy Mist", "Arctic Frost", "Coffee Warm Sand"]);
  });

  it("exposes exactly four navigation chromes in the approved order", () => {
    expect(THEME_CHROME_IDS).toEqual(["navy", "graphite", "sapphire", "forest"]);
    expect(CHROMES.map((item) => item.name)).toEqual(["Navy & Gold", "Graphite Grey", "Sapphire Blue", "Forest Pine"]);
  });

  it("defaults to Navy and Gold with Porcelain", () => {
    expect(FVI_FACTORY_PRESET).toEqual({ palette: "porcelain", chrome: "navy", topChrome: "navy", dualMode: false });
  });

  it("migrates every legacy canvas preference deterministically", () => {
    expect(normalizePaletteId("cloud-white")).toBe("porcelain");
    expect(normalizePaletteId("paper-ink")).toBe("porcelain");
    expect(normalizePaletteId("warm-sand")).toBe("coffee-warm-sand");
    expect(normalizePaletteId("coffee-cream")).toBe("coffee-warm-sand");
    expect(normalizePaletteId("cream-amber")).toBe("coffee-warm-sand");
    expect(normalizePaletteId("sage-bone")).toBe("cloudy-mist");
    expect(normalizePaletteId("rose-quartz")).toBe("cloudy-mist");
    expect(normalizePaletteId("unknown")).toBe("porcelain");
  });

  it("migrates legacy navigation preferences into the approved catalogue", () => {
    for (const legacy of ["midnight", "slate", "sky-light"]) expect(normalizeChromeId(legacy)).toBe("sapphire");
    for (const legacy of ["charcoal", "pearl", "mist", "crimson", "plum", "blush"]) expect(normalizeChromeId(legacy)).toBe("graphite");
    for (const legacy of ["sage-light", "mint-light"]) expect(normalizeChromeId(legacy)).toBe("forest");
    for (const legacy of ["espresso", "porcelain", "linen", "sand", "honey-light", "unknown"]) expect(normalizeChromeId(legacy)).toBe("navy");
  });

  it("retains a real light and dark appearance mode", () => {
    expect(normalizeThemeMode("dark")).toBe("dark");
    expect(normalizeThemeMode("light")).toBe("light");
    expect(normalizeThemeMode("unknown")).toBe("light");
    const provider = readFileSync("src/components/theme-provider.tsx", "utf8");
    expect(provider).toContain('root.classList.toggle("dark", theme === "dark")');
    expect(provider).toContain('localStorage.setItem("fvi-theme", theme)');
  });

  it("removes Cloud White from runtime metadata and CSS selectors", () => {
    const config = readFileSync("src/lib/theme-config.ts", "utf8");
    const css = readFileSync("src/styles.css", "utf8");
    expect(config).not.toContain('name: "Cloud White"');
    expect(css).not.toContain('data-palette="cloud-white"');
    expect(css).toContain('data-palette="cloudy-mist"');
    expect(css).toContain('data-palette="coffee-warm-sand"');
  });

  it("does not expose or reapply the superseded platform palette catalogue", () => {
    const dialog = readFileSync("src/components/user-prefs-dialog.tsx", "utf8");
    const shell = readFileSync("src/components/app-shell.tsx", "utf8");
    expect(dialog).not.toContain("SeededPaletteSwitcher");
    expect(shell).not.toContain("SeededPaletteApplier");
  });

  it("migrates persisted tenant rows before enforcing database constraints", () => {
    const sql = readFileSync("supabase/migrations/20260913170000_consolidate_theme_catalog.sql", "utf8");
    expect(sql.indexOf("UPDATE public.tenant_theme_settings")).toBeLessThan(sql.indexOf("ADD CONSTRAINT tenant_theme_settings_palette_id_check"));
    expect(sql).toContain("ALTER COLUMN palette_id SET DEFAULT 'porcelain'");
    expect(sql).toContain("CHECK (palette_id IN ('porcelain','cloudy-mist','arctic-frost','coffee-warm-sand'))");
    expect(sql).toContain("CHECK (side_chrome_id IN ('navy','graphite','sapphire','forest'))");
    expect(sql).toContain("tenant.theme.catalog_migrated");
  });
});
