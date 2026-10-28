import { describe, expect, it } from "vitest";

import {
  DEFAULT_SCREEN_FIXTURES,
  discoverUiScreens,
  resolveScreenPath,
  summarizeScreenCoverage,
} from "../scripts/screen-coverage-catalog.mjs";

describe("owner-session screen coverage catalogue", () => {
  const screens = discoverUiScreens();

  it("classifies the exact current UI route inventory", () => {
    const summary = summarizeScreenCoverage(screens, {});

    expect(summary.total).toBe(121);
    expect(summary.public + summary.authenticated).toBe(summary.total);
    expect(summary.byArea).toMatchObject({
      public: expect.any(Number),
      "platform-admin": expect.any(Number),
      "tenant-admin": expect.any(Number),
      workspace: expect.any(Number),
      "marketing-admin": expect.any(Number),
    });
  });

  it("classifies the AAL2 challenge as an authenticated screen", () => {
    const challenge = screens.find((screen) => screen.routeId === "/mfa-challenge");
    expect(challenge).toMatchObject({ area: "authentication", requiresAuth: true });
  });

  it("includes the scanner-resistant auth confirmation interstitial as a public screen", () => {
    const confirmation = screens.find((screen) => screen.routeId === "/confirm-auth");
    expect(confirmation).toMatchObject({
      area: "public",
      requiresAuth: false,
      mutation: "none",
    });
  });

  it("has one classification for every screen and no duplicate source route", () => {
    expect(new Set(screens.map((screen) => screen.sourceFile)).size).toBe(screens.length);
    expect(new Set(screens.map((screen) => screen.routeId)).size).toBe(screens.length);
    expect(screens.every((screen) => screen.mutation === "none")).toBe(true);
  });

  it("names every fixture required by parameterized screens and defaults only static routes", () => {
    const parameterized = screens.filter((screen) => screen.parameters.length > 0);

    expect(parameterized.length).toBeGreaterThan(0);
    for (const screen of parameterized) {
      expect(
        screen.parameters.every((parameter) => parameter.environment.startsWith("FVI_E2E_")),
      ).toBe(true);
      const expectedMissing = screen.parameters
        .map((parameter) => parameter.environment)
        .filter((environment) => !DEFAULT_SCREEN_FIXTURES[environment]);
      expect(resolveScreenPath(screen, {}).missing).toEqual(expectedMissing);
    }
  });

  it("resolves deterministic source-backed defaults for public and documentation routes", () => {
    const routeIds = [
      "/solutions/$slug",
      "/support/$category/",
      "/support/$category/$article",
      "/_authenticated/docs/$",
    ];

    for (const routeId of routeIds) {
      const screen = screens.find((candidate) => candidate.routeId === routeId);
      expect(screen).toBeDefined();
      expect(resolveScreenPath(screen!, {}).missing).toEqual([]);
    }
  });

  it("resolves fixture values without allowing path-segment injection", () => {
    const solution = screens.find((screen) => screen.routeId === "/solutions/$slug");
    expect(solution).toBeDefined();

    expect(
      resolveScreenPath(solution!, { FVI_E2E_SOLUTION_SLUG: "banking/reconciliation" }),
    ).toEqual({ path: "/solutions/banking%2Freconciliation", missing: [] });
  });
});
