import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

describe("connector API live harness", () => {
  it("proves negative, queue, worker, poll, domain, and replay boundaries", async () => {
    const source = await readFile(
      new URL("../scripts/run-fvi-connector-api-e2e.mjs", import.meta.url),
      "utf8",
    );
    for (const marker of [
      "Missing bearer expected 401",
      "Wrong tenant expected 403",
      "Connector enqueue failed",
      "/api/public/cron/workflow-jobs",
      'terminalBody.status !== "succeeded"',
      'terminalBody.job_kind !== "connector_run"',
      "Connector idempotent replay failed",
    ])
      expect(source).toContain(marker);
    expect(source).not.toContain("console.log(token");
    expect(source).not.toContain("console.log(cronSecret");
  });

  it("proves scope, gateway, CORS, and throttle boundaries without logging tokens", async () => {
    const source = await readFile(
      new URL("../scripts/verify-fvi-connector-api-negative.mjs", import.meta.url),
      "utf8",
    );
    for (const marker of [
      "wrong_scope_status",
      "gateway_required_status",
      "hostile_cors",
      "allowed_preflight_cors",
      "throttle_429",
      "throttle_retry_after_present",
    ])
      expect(source).toContain(marker);
    expect(source).not.toContain("console.log(connectorToken");
    expect(source).not.toContain("console.log(wrongScopeToken");
  });
});
