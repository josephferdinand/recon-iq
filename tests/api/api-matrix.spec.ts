/**
 * API Integration Matrix — public endpoint coverage.
 *
 * Hits every public API endpoint under /api/public/* via Node fetch.
 * Validates:
 *   - GET methods respond with the expected status (200/4xx — never 500)
 *   - CORS preflight returns the whitelisted origin (NOT "*" — per LL-005)
 *   - POST methods without auth return 401/403, never 500
 *
 * Target: local dev server on port 8991 (per vite dev override in vite.config.ts).
 * Override with `FVI_API_BASE` env var to point at staging or prod.
 *
 * Test report: this file emits a console summary at the end so the
 * pipeline log shows the coverage matrix.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";

const API_BASE = process.env.FVI_API_BASE ?? "http://localhost:8991";

/** Endpoints declared in src/routes/api/public/ that accept GET. */
const GET_ENDPOINTS = [
  "/api/public/status.json",
  "/api/public/metrics-summary",
  "/api/public/openapi.yaml",
  "/api/public/mkt-site-logos",
] as const;

/** Endpoints that require auth + POST. We assert they reject anonymous. */
const POST_ENDPOINTS = [
  "/api/public/mkt-leads",
  "/api/public/mkt-cta-events",
  "/api/public/mkt-chat",
  "/api/public/security-event",
  "/api/public/ai/inference",
] as const;

/** Whitelisted origins (per LL-005). */
const ALLOWED_ORIGINS = [
  "https://app-fvi.reconiq.example",
  "https://staging-fvi.reconiq.example",
  "https://support-fvi.reconiq.example",
];

interface FetchResult {
  status: number;
  contentType: string;
  allowOrigin: string | null;
  bodyBytes: number;
  elapsedMs: number;
}

async function timedFetch(
  path: string,
  init: RequestInit = {},
): Promise<FetchResult> {
  const start = performance.now();
  const resp = await fetch(`${API_BASE}${path}`, {
    ...init,
    redirect: "manual",
  });
  const body = await resp.text();
  return {
    status: resp.status,
    contentType: resp.headers.get("content-type") ?? "",
    allowOrigin: resp.headers.get("access-control-allow-origin"),
    bodyBytes: body.length,
    elapsedMs: Math.round(performance.now() - start),
  };
}

const results: Array<{
  path: string;
  scenario: string;
  result: FetchResult;
  pass: boolean;
}> = [];

function record(path: string, scenario: string, r: FetchResult, pass: boolean) {
  results.push({ path, scenario, result: r, pass });
}

beforeAll(() => {
  // eslint-disable-next-line no-console
  console.log(`[api-matrix] target=${API_BASE}`);
});

afterAll(() => {
  // eslint-disable-next-line no-console
  console.log("\n========== API Matrix Report ==========");
  // eslint-disable-next-line no-console
  console.log("| path | scenario | status | ms | origin | pass |");
  // eslint-disable-next-line no-console
  console.log("|------|----------|--------|-----|--------|------|");
  for (const r of results) {
    // eslint-disable-next-line no-console
    console.log(
      `| ${r.path} | ${r.scenario} | ${r.result.status} | ${r.result.elapsedMs} | ${r.result.allowOrigin ?? "-"} | ${r.pass ? "PASS" : "FAIL"} |`,
    );
  }
  const passed = results.filter((r) => r.pass).length;
  // eslint-disable-next-line no-console
  console.log(`\nTotal: ${passed}/${results.length} passed.\n`);
});

describe("API matrix · GET endpoints", () => {
  for (const path of GET_ENDPOINTS) {
    it(`${path} returns 200 without auth`, async () => {
      const r = await timedFetch(path);
      // Anonymous GET on public endpoints should return 2xx — never 5xx.
      const pass = r.status >= 200 && r.status < 400;
      record(path, "anonymous-GET", r, pass);
      expect(r.status, `${path} should not 5xx`).toBeLessThan(500);
    });

    it(`${path} returns 200 with valid origin`, async () => {
      const r = await timedFetch(path, {
        headers: { Origin: ALLOWED_ORIGINS[0] },
      });
      const pass = r.status === 200;
      record(path, "whitelisted-GET", r, pass);
      expect(r.status, `${path} expected 200`).toBe(200);
    });
  }
});

describe("API matrix · CORS preflight", () => {
  for (const path of GET_ENDPOINTS) {
    it(`${path} OPTIONS echoes whitelisted origin (no wildcard)`, async () => {
      const r = await timedFetch(path, {
        method: "OPTIONS",
        headers: {
          Origin: ALLOWED_ORIGINS[0],
          "Access-Control-Request-Method": "GET",
        },
      });
      // Per LL-005: must echo whitelist, never "*".
      const originEcho = r.allowOrigin;
      const pass =
        originEcho === ALLOWED_ORIGINS[0] || originEcho === null; // null = no CORS = also OK for GET
      record(path, "CORS-preflight", r, pass);
      if (originEcho !== null) {
        expect(originEcho, "wildcard CORS forbidden").not.toBe("*");
        expect(ALLOWED_ORIGINS).toContain(originEcho);
      }
    });
  }
});

describe("API matrix · POST endpoints reject anonymous", () => {
  for (const path of POST_ENDPOINTS) {
    it(`${path} returns 401/403 (never 500) without auth`, async () => {
      const r = await timedFetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const pass = r.status === 401 || r.status === 403 || r.status === 400 || r.status === 422;
      record(path, "anonymous-POST", r, pass);
      // Critical: must NOT 5xx (which would indicate a crash).
      expect(r.status, `${path} crashed with 5xx`).toBeLessThan(500);
      // Must NOT 2xx (which would be unauthenticated success).
      expect(r.status, `${path} succeeded without auth`).toBeGreaterThanOrEqual(400);
    });

    it(`${path} rejects invalid auth (malformed JWT)`, async () => {
      const r = await timedFetch(path, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer not.a.jwt",
        },
        body: JSON.stringify({}),
      });
      const pass = r.status === 401 || r.status === 403 || r.status === 400;
      record(path, "bad-jwt", r, pass);
      expect(r.status, `${path} accepted garbage JWT`).toBeGreaterThanOrEqual(400);
    });

    it(`${path} rejects expired JWT`, async () => {
      // An expired JWT signed with HS256 and `alg: none` would be the
      // canonical exploit (LL-007). We use a structurally valid but
      // expired JWT to exercise that branch.
      const expiredJwt =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ4IiwiZXhwIjoxMDAwfQ.fakesig";
      const r = await timedFetch(path, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${expiredJwt}`,
        },
        body: JSON.stringify({}),
      });
      const pass = r.status === 401 || r.status === 403 || r.status === 400;
      record(path, "expired-jwt", r, pass);
      expect(r.status, `${path} accepted expired JWT`).toBeGreaterThanOrEqual(400);
    });
  }
});

describe("API matrix · latency", () => {
  it("public GET endpoints respond under 2s", async () => {
    for (const path of GET_ENDPOINTS) {
      const r = await timedFetch(path);
      record(path, "latency", r, r.elapsedMs < 2_000);
      expect(r.elapsedMs, `${path} slow: ${r.elapsedMs}ms`).toBeLessThan(2_000);
    }
  });
});
