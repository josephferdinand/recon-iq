import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";

import { discoverUiScreens, resolveScreenPath } from "../../scripts/screen-coverage-catalog.mjs";
import { ALL_TOUR_IDS } from "../../src/lib/tour-registry";

const screens = discoverUiScreens();
const storageState = process.env.FVI_OWNER_STORAGE_STATE;
const authenticatedEnabled =
  process.env.FVI_RUN_AUTHENTICATED_SCREEN_MATRIX === "YES" &&
  Boolean(storageState && existsSync(storageState));
const hydrationConsoleEnabled = process.env.FVI_ASSERT_HYDRATION_CONSOLE === "YES";

for (const screen of screens) {
  test(`${screen.area}: ${screen.pathTemplate}`, async ({ page }, testInfo) => {
    if (["/$slug/tenant/templates", "/platform-marketplace"].includes(screen.pathTemplate)) {
      test.setTimeout(120_000);
    }
    const hydrationErrors: string[] = [];
    if (hydrationConsoleEnabled) {
      page.on("console", (message) => {
        if (message.type() !== "error") return;
        const text = message.text();
        if (/hydration|react error #?418|minified react error 418/i.test(text)) {
          hydrationErrors.push(text);
        }
      });
      page.on("pageerror", (error) => {
        if (/hydration|react error #?418|minified react error 418/i.test(error.message)) {
          hydrationErrors.push(error.message);
        }
      });
    }
    if (screen.requiresAuth) {
      test.skip(
        !authenticatedEnabled,
        "Requires FVI_RUN_AUTHENTICATED_SCREEN_MATRIX=YES and an existing FVI_OWNER_STORAGE_STATE",
      );
    }

    const resolved = resolveScreenPath(screen);
    test.skip(
      resolved.missing.length > 0,
      `Missing named fixture environment: ${resolved.missing.join(", ")}`,
    );
    testInfo.annotations.push({ type: "source-route", description: screen.sourceFile });
    testInfo.annotations.push({ type: "mutation", description: screen.mutation });

    const dynamicWorkspaceTourId = process.env.FVI_E2E_PLATFORM_TENANT_ID
      ? `workspace-${process.env.FVI_E2E_PLATFORM_TENANT_ID}-v2`
      : null;
    await page.addInitScript(
      ({ tourIds, dynamicTourId }) => {
        const key = "fvi.prefs.v1";
        try {
          const current = JSON.parse(localStorage.getItem(key) ?? "{}");
          const seen = Object.fromEntries(
            [...tourIds, ...(dynamicTourId ? [dynamicTourId] : [])].map((id) => [id, true]),
          );
          localStorage.setItem(
            key,
            JSON.stringify({
              ...current,
              tourSeen: { ...(current.tourSeen ?? {}), ...seen },
              tourProgress: {},
            }),
          );
        } catch {
          localStorage.setItem(
            key,
            JSON.stringify({ tourSeen: Object.fromEntries(tourIds.map((id) => [id, true])) }),
          );
        }
      },
      { tourIds: ALL_TOUR_IDS, dynamicTourId: dynamicWorkspaceTourId },
    );
    await page.emulateMedia({ reducedMotion: "reduce" });

    const started = Date.now();
    const response = await page.goto(resolved.path!, { waitUntil: "domcontentloaded" });
    const elapsed = Date.now() - started;
    const status = response?.status() ?? 0;

    expect(status, `${screen.pathTemplate} must return an HTTP response`).toBeGreaterThan(0);
    expect(status, `${screen.pathTemplate} must not return a server error`).toBeLessThan(500);
    expect(elapsed, `${screen.pathTemplate} DOMContentLoaded budget`).toBeLessThan(20_000);
    await expect(page.locator("body")).toBeVisible();
    await page.addStyleTag({
      content:
        "*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;transition-delay:0s!important}",
    });
    if (hydrationConsoleEnabled) {
      testInfo.annotations.push({ type: "hydration-console", description: "enabled" });
      await page.waitForTimeout(1_000);
      await expect(page.locator("body"), "body must remain mounted after hydration").toBeVisible();
      expect(hydrationErrors, `${screen.pathTemplate} hydration errors`).toEqual([]);
    }

    // Section tours intentionally auto-open for a first-time user. Complete
    // their single-step popover before auditing the underlying route so the
    // dimmed overlay does not create transient background contrast results.
    await page.waitForTimeout(650);
    const finishTour = page.getByRole("button", { name: "Finish", exact: true });
    if (await finishTour.isVisible().catch(() => false)) {
      await finishTour.click();
      await expect(page.locator(".driver-overlay")).toBeHidden();
    }

    // Audit the settled page rather than a short-lived authorization skeleton.
    // If access never resolves, this fails explicitly instead of hiding the defect.
    await expect(page.getByText("Resolving access…", { exact: true })).toHaveCount(0, {
      timeout: 12_000,
    });
    await page.waitForTimeout(250);
    if (await page.locator("body.driver-active").count()) {
      await page.keyboard.press("Escape");
      await expect(page.locator("body")).not.toHaveClass(/driver-active/u);
    }
    if (screen.pathTemplate === "/developers/api-reference") {
      await expect(page.locator("#fvi-redoc")).toHaveAttribute("data-redoc-status", "ready", {
        timeout: 20_000,
      });
      await expect(
        page.locator("#fvi-redoc").getByText("Download", { exact: true }).first(),
      ).toBeVisible();
    }

    const headers = response?.headers() ?? {};
    expect(headers["strict-transport-security"]).toContain("max-age=");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");

    if (screen.requiresAuth) {
      expect(
        new URL(page.url()).pathname,
        "authenticated session must not fall back to sign-in",
      ).not.toBe("/auth");
    }

    const accessibility = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      accessibility.violations.filter((violation) =>
        ["critical", "serious"].includes(violation.impact ?? ""),
      ),
    ).toEqual([]);

    if (screen.pathTemplate === "/solutions/$slug") {
      await page.waitForTimeout(6_000);
      await expect(page.locator("body"), "solution hydration must remain mounted").toBeVisible();
      await expect(page).toHaveTitle(/\S/u);
    }
  });
}
