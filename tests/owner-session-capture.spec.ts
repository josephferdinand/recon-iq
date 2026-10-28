import path from "node:path";
import { describe, expect, it } from "vitest";

import { resolveOwnerSessionCaptureOptions } from "../scripts/capture-owner-session.mjs";

const root = path.resolve("C:/safe/fvi");

describe("owner session capture options", () => {
  it("defaults to DEV and an ignored evidence path", () => {
    const options = resolveOwnerSessionCaptureOptions({ root, environment: {}, argv: [] });

    expect(options.baseUrl).toBe("https://dev.app.reconiq.example");
    expect(options.authUrl).toBe("https://dev.app.reconiq.example/auth");
    expect(options.outputPath).toBe(
      path.resolve(root, "_e2e_run/owner-session/storage-state.json"),
    );
    expect(options.timeoutMs).toBe(600_000);
  });

  it("rejects PROD and non-FVI capture targets", () => {
    expect(() =>
      resolveOwnerSessionCaptureOptions({
        root,
        environment: { FVI_E2E_BASE_URL: "https://app.reconiq.example" },
      }),
    ).toThrow(/restricted to https:\/\/dev\.app\.falconveritas\.com/u);
  });

  it("rejects storage state outside the ignored evidence directory", () => {
    expect(() =>
      resolveOwnerSessionCaptureOptions({
        root,
        environment: { FVI_OWNER_STORAGE_STATE: "../owner-state.json" },
      }),
    ).toThrow(/inside the ignored _e2e_run directory/u);
  });

  it("accepts a bounded timeout and nested ignored JSON path", () => {
    const options = resolveOwnerSessionCaptureOptions({
      root,
      environment: {},
      argv: ["--output=_e2e_run/private/owner.json", "--timeout-seconds=900"],
    });

    expect(options.outputPath).toBe(path.resolve(root, "_e2e_run/private/owner.json"));
    expect(options.timeoutMs).toBe(900_000);
  });
});
