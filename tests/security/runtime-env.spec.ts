import { afterEach, describe, expect, it } from "vitest";
import { getRuntimeEnv, installRuntimeEnv } from "@/lib/runtime-env.server";

const KEY = "FVI_RUNTIME_ENV_TEST_SECRET";

afterEach(() => {
  delete process.env[KEY];
  delete (globalThis as unknown as { __env?: Record<string, unknown> }).__env;
});

describe("Cloudflare runtime environment bridge", () => {
  it("prefers the live binding and mirrors strings into process.env", () => {
    process.env[KEY] = "stale-build-value";
    installRuntimeEnv({ [KEY]: "live-binding-value" });
    expect(getRuntimeEnv(KEY)).toBe("live-binding-value");
    expect(process.env[KEY]).toBe("live-binding-value");
  });

  it("keeps resource bindings out of process.env", () => {
    installRuntimeEnv({ AUDIT_ANCHORS: { put: () => undefined } });
    expect(process.env.AUDIT_ANCHORS).toBeUndefined();
    expect((globalThis as unknown as { __env?: Record<string, unknown> }).__env?.AUDIT_ANCHORS).toBeTruthy();
  });
});
