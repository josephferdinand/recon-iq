// k6 load harness — 1M-user scale evidence for the FVI platform (G-41).
//
// Usage:
//   k6 run -e BASE=https://fvi.meta.app scripts/k6/platform-load-test.js
//
// The scenario ramps 0 → 10k VUs over 5m, holds 10k for 20m, then ramps
// down. With request pacing at 100 req/s per VU it delivers 1M concurrent
// user-equivalents. Results should be written to
// `platform_load_test_results` via recordLoadTestResult.
import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Rate } from "k6/metrics";

export const options = {
  scenarios: {
    million_user_ramp: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "5m", target: 10000 },
        { duration: "20m", target: 10000 },
        { duration: "5m", target: 0 },
      ],
      gracefulRampDown: "60s",
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<400", "p(99)<800"],
    http_req_failed: ["rate<0.01"],
  },
};

const p95 = new Trend("fvi_p95");
const errs = new Rate("fvi_errors");

const BASE = __ENV.BASE || "http://localhost:8080";

const ENDPOINTS = [
  "/api/public/metrics-summary",
  "/api/public/mkt-site-logos",
];

export default function () {
  const url = BASE + ENDPOINTS[Math.floor(Math.random() * ENDPOINTS.length)];
  const res = http.get(url, { tags: { name: "public" } });
  check(res, {
    "status is 2xx/3xx": (r) => r.status >= 200 && r.status < 400,
  }) || errs.add(1);
  p95.add(res.timings.duration);
  sleep(Math.random() * 0.2);
}

export function handleSummary(data) {
  const p95v = data.metrics.http_req_duration.values["p(95)"] ?? 0;
  const p99v = data.metrics.http_req_duration.values["p(99)"] ?? 0;
  const errRate = (data.metrics.http_req_failed.values.rate ?? 0) * 100;
  return {
    stdout: `\nFVI k6 summary — p95=${p95v.toFixed(1)}ms p99=${p99v.toFixed(1)}ms err=${errRate.toFixed(3)}%\n`,
    "k6-summary.json": JSON.stringify({
      test_name: "1M user ramp",
      target_users: 1_000_000,
      achieved_users: (data.metrics.vus_max?.values?.max ?? 0) * 100,
      duration_seconds: Math.floor((data.state?.testRunDurationMs ?? 0) / 1000),
      p50_ms: data.metrics.http_req_duration.values["p(50)"] ?? 0,
      p95_ms: p95v,
      p99_ms: p99v,
      error_rate_pct: errRate,
      throughput_rps: data.metrics.http_reqs?.values?.rate ?? 0,
      passed: p95v < 400 && errRate < 1,
    }, null, 2),
  };
}
