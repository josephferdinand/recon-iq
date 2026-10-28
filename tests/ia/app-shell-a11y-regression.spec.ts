// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { normalizeDriverAccessibility } from "@/lib/driver-accessibility";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("shared application-shell accessibility", () => {
  it("normalizes Driver.js's invisible focus target to valid button semantics", () => {
    const target = document.createElement("div");
    target.id = "driver-dummy-element";
    target.setAttribute("aria-haspopup", "dialog");
    target.setAttribute("aria-expanded", "true");
    document.body.append(target);

    normalizeDriverAccessibility();

    expect(target.getAttribute("role")).toBe("button");
    expect(target.getAttribute("aria-label")).toBe("Guided tour focus target");
    expect(target.getAttribute("tabindex")).toBe("-1");
  });

  it("keeps collapsed sidebar links inert and uses sidebar-aware contrast tokens", () => {
    const shellSource = readFileSync(path.resolve("src/components/app-shell.tsx"), "utf8");
    const railSource = readFileSync(path.resolve("src/components/left-rail.tsx"), "utf8");

    for (const source of [shellSource, railSource]) {
      expect(source).toContain("inert={!isOpen}");
      expect(source).toContain("text-sidebar-foreground/80");
      expect(source).not.toContain("tracking-wider text-muted-foreground hover:bg-sidebar");
    }
  });

  it("gives the theme trigger an explicit foreground color", () => {
    const source = readFileSync(path.resolve("src/components/user-prefs-dialog.tsx"), "utf8");
    expect(source).toContain('className="gap-1.5 text-foreground"');
  });

  it("gives shared select triggers a fallback accessible name", () => {
    const source = readFileSync(path.resolve("src/components/ui/select.tsx"), "utf8");
    expect(source).toContain('aria-label="Select an option"');
  });
});
