import { afterEach, describe, expect, it } from "vitest";

import { verifyCronSecret } from "@/lib/cron-auth.server";

type RuntimeGlobal = typeof globalThis & {
  __env?: Record<string, string>;
};

const originalProcessSecret = process.env.SLA_CRON_HMAC;
const originalAidpSecret = process.env.AIDP_JOB_CRON_SECRET;
const originalRuntimeEnv = (globalThis as RuntimeGlobal).__env;

afterEach(() => {
  if (originalProcessSecret === undefined) {
    delete process.env.SLA_CRON_HMAC;
  } else {
    process.env.SLA_CRON_HMAC = originalProcessSecret;
  }
  if (originalAidpSecret === undefined) {
    delete process.env.AIDP_JOB_CRON_SECRET;
  } else {
    process.env.AIDP_JOB_CRON_SECRET = originalAidpSecret;
  }

  if (originalRuntimeEnv === undefined) {
    delete (globalThis as RuntimeGlobal).__env;
  } else {
    (globalThis as RuntimeGlobal).__env = originalRuntimeEnv;
  }
});

function requestWithSecret(secret?: string): Request {
  return new Request("https://app.reconiq.example/api/public/cron/test", {
    method: "POST",
    headers: secret ? { "x-cron-secret": secret } : undefined,
  });
}

describe("verifyCronSecret", () => {
  it("prefers the live Cloudflare binding over a stale build-time value", () => {
    process.env.SLA_CRON_HMAC = "stale-build-secret";
    (globalThis as RuntimeGlobal).__env = {
      SLA_CRON_HMAC: "current-runtime-secret",
    };

    expect(verifyCronSecret(requestWithSecret("current-runtime-secret"))).toBeNull();

    const staleResponse = verifyCronSecret(requestWithSecret("stale-build-secret"));
    expect(staleResponse?.status).toBe(401);
  });

  it("uses process.env as the local Node fallback", () => {
    process.env.SLA_CRON_HMAC = "local-secret";
    delete (globalThis as RuntimeGlobal).__env;

    expect(verifyCronSecret(requestWithSecret("local-secret"))).toBeNull();
  });

  it("isolates the dedicated AIDP scheduler secret from the shared cron secret", () => {
    (globalThis as RuntimeGlobal).__env = {
      SLA_CRON_HMAC: "shared-cron-secret",
      AIDP_JOB_CRON_SECRET: "dedicated-aidp-secret",
    };
    expect(verifyCronSecret(requestWithSecret("dedicated-aidp-secret"), "AIDP_JOB_CRON_SECRET")).toBeNull();
    expect(verifyCronSecret(requestWithSecret("shared-cron-secret"), "AIDP_JOB_CRON_SECRET")?.status).toBe(401);
  });

  it("rejects an anonymous caller before revealing configuration state", async () => {
    delete process.env.SLA_CRON_HMAC;
    delete (globalThis as RuntimeGlobal).__env;

    const response = verifyCronSecret(requestWithSecret());
    expect(response?.status).toBe(401);
    await expect(response?.text()).resolves.toBe("Unauthorized");
  });

  it("fails closed when an authenticated-shaped request reaches an unconfigured runtime", async () => {
    delete process.env.SLA_CRON_HMAC;
    delete (globalThis as RuntimeGlobal).__env;

    const response = verifyCronSecret(requestWithSecret("presented-secret"));
    expect(response?.status).toBe(503);
    await expect(response?.text()).resolves.toBe("Cron secret not configured");
  });
});
