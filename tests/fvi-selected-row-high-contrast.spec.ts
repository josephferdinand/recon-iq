import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/styles.css", "utf8");

function ruleBody(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escapedSelector}\\s*\\{([^}]+)\\}`));
  expect(match, `missing CSS rule for ${selector}`).toBeTruthy();
  return match![1];
}

function hexToken(body: string, name: string) {
  const value = body.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, "iu"))?.[1];
  expect(value, `missing ${name} hex token`).toBeTruthy();
  return value!;
}

function luminance(hex: string) {
  const channels = hex.slice(1).match(/.{2}/gu)!.map((value) => Number.parseInt(value, 16) / 255);
  const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(foreground: string, background: string) {
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

describe("theme-aware selected rows", () => {
  it("uses canvas accent pairs by default and the approved Navy chrome tokens", () => {
    const base = ruleBody(".fvi-selected-row");
    expect(base).toContain("--fvi-selected-row-bg: var(--accent)");
    expect(base).toContain("--fvi-selected-row-fg: var(--accent-foreground)");
    expect(base).toContain("--fvi-selected-row-edge: var(--primary)");

    const selectedChrome = ruleBody(':root[data-chrome] .fvi-selected-row');
    expect(selectedChrome).toContain("--fvi-selected-row-bg: var(--sidebar-primary)");
    expect(selectedChrome).toContain("--fvi-selected-row-fg: var(--sidebar-primary-foreground)");
    for (const chromeId of ["midnight", "charcoal", "graphite", "slate", "forest", "crimson", "sapphire", "espresso", "plum"]) {
      expect(css).toContain(`[data-chrome="${chromeId}"]`);
    }
    expect(css).toContain(':root:is([data-chrome="midnight"]');
    expect(css).toContain('--fvi-selected-row-bg: var(--sidebar-accent)');

    const navy = ruleBody(':root[data-chrome="navy"] .fvi-selected-row');
    expect(navy).toContain("--fvi-selected-row-bg: var(--sidebar-accent)");
    expect(navy).toContain("--fvi-selected-row-fg: var(--sidebar-accent-foreground)");
    expect(navy).toContain("--fvi-selected-row-edge: var(--sidebar-primary)");
    const chrome = ruleBody(':root[data-chrome="navy"]');
    expect(chrome).toContain("--sidebar-primary: #c9a44c");
    expect(contrastRatio(hexToken(chrome, "--sidebar-accent-foreground"), hexToken(chrome, "--sidebar-accent"))).toBeGreaterThanOrEqual(7);
  });

  it("adds a shape marker and visible keyboard focus without flattening semantic badges", () => {
    const marker = ruleBody(".fvi-selected-row > :first-child::before");
    expect(marker).toContain('content: "✓"');
    expect(marker).toContain("border-radius: 9999px");
    expect(css).toContain(".fvi-selected-row:focus-visible");
    expect(css).toContain(".fvi-selected-row :focus-visible");
    expect(css).not.toMatch(/\.fvi-selected-row\s+\.text-(?:success|destructive|warning)/u);
  });

  it("keeps View legible with the active theme accent on selected rows", () => {
    const action = ruleBody(".fvi-selected-row .fvi-row-view-action");
    expect(action).toContain("background-color: var(--fvi-selected-row-edge)");
    expect(action).toContain("color: var(--sidebar-primary-foreground, var(--primary-foreground))");
    const navy = ruleBody(':root[data-chrome="navy"]');
    expect(contrastRatio(hexToken(navy, "--sidebar-primary-foreground"), hexToken(navy, "--sidebar-primary"))).toBeGreaterThanOrEqual(4.5);
    expect(css).toContain(".fvi-selected-row .fvi-row-view-action:hover");
  });

  it("keeps selected text readable in every configured chrome", () => {
    const darkChromes = new Set(["navy", "midnight", "charcoal", "graphite", "slate", "forest", "crimson", "sapphire", "espresso", "plum"]);
    const chromeIds = [...css.matchAll(/:root\[data-chrome="([^"]+)"\]\s*\{/gu)].map((match) => match[1]);
    expect(chromeIds.length).toBeGreaterThanOrEqual(15);
    for (const id of chromeIds) {
      const theme = ruleBody(`:root[data-chrome="${id}"]`);
      const background = hexToken(theme, darkChromes.has(id) ? "--sidebar-accent" : "--sidebar-primary");
      const foreground = hexToken(theme, darkChromes.has(id) ? "--sidebar-accent-foreground" : "--sidebar-primary-foreground");
      expect(contrastRatio(foreground, background), `${id} selected-row text contrast`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("uses system highlight colors in forced-colors mode", () => {
    expect(css).toContain("@media (forced-colors: active)");
    expect(css).toMatch(/\.fvi-selected-row\s*\{[^}]*background:\s*Highlight;[^}]*color:\s*HighlightText;/su);
    expect(css).toContain("border-inline-start-color: HighlightText");
    expect(css).toContain("background: HighlightText;");
    expect(css).toContain("color: Highlight;");
  });
});
