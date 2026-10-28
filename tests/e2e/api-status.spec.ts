import { test, expect } from "@playwright/test";

/**
 * /api/public/status.json smoke test.
 *
 * The status endpoint is the only public endpoint documented in the
 * FVI Sprint Plan §5.5 as "always-online". This test guards it.
 */

test("GET /api/public/status.json returns a truthful snapshot or explicit unavailability", async ({ request }) => {
  const resp = await request.get("/api/public/status.json");
  expect([200, 503]).toContain(resp.status());
  expect(resp.headers()["content-type"]).toMatch(/application\/json/i);

  const body = await resp.json();
  expect(["operational", "degraded_performance", "partial_outage", "major_outage", "maintenance"])
    .toContain(body.overall);
  expect(["complete", "partial", "unavailable"]).toContain(body.data_status);
  expect(Array.isArray(body.components)).toBe(true);
  expect(Array.isArray(body.history)).toBe(true);
  expect(Array.isArray(body.incidents)).toBe(true);
  expect(Number.isFinite(Date.parse(body.generated_at))).toBe(true);
  if (resp.status() === 503) {
    expect(body.data_status).toBe("unavailable");
    expect(body.overall).not.toBe("operational");
    expect(resp.headers()["cache-control"]).toBe("no-store");
  } else {
    expect(body.data_status).not.toBe("unavailable");
  }
});

test("CORS preflight for /api/public/status.json", async ({ request }) => {
  const resp = await request.fetch("/api/public/status.json", {
    method: "OPTIONS",
    headers: {
      Origin: "https://app.reconiq.example",
      "Access-Control-Request-Method": "GET",
    },
  });

  // Per LL-005, CORS is whitelisted — the allowed origin should echo back.
  // If wildcard is ever re-introduced, this test will catch it.
  const allowOrigin = resp.headers()["access-control-allow-origin"];
  expect(
    allowOrigin === "https://app.reconiq.example" || allowOrigin === "https://reconiq.example",
    `expected whitelisted origin in CORS, got "${allowOrigin}"`,
  ).toBeTruthy();
});
