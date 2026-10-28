import { afterEach, describe, expect, it } from "vitest";
import {
  signEnvironmentPackage,
  verifyEnvironmentPackage,
} from "@/lib/environment-package-file.server";

const KEY = "ENVIRONMENT_PACKAGE_HMAC_KEY";
const ORIGINAL = process.env[KEY];

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env[KEY];
  else process.env[KEY] = ORIGINAL;
});

describe("signed environment package envelopes", () => {
  it("round-trips an approved secret-free package", async () => {
    process.env[KEY] = "0123456789abcdef".repeat(4);
    const payload = {
      target_project_ref: "target-project-ref",
      target_tenant_id: "a5555555-5555-4555-8555-555555555555",
      manifest: { settings: { tenant_identity: { release_identity_uid: "family-a" } } },
    };
    const envelope = await signEnvironmentPackage(payload);
    await expect(verifyEnvironmentPackage(envelope)).resolves.toEqual(payload);
  });

  it("rejects payload and signature tampering", async () => {
    process.env[KEY] = "0123456789abcdef".repeat(4);
    const envelope = await signEnvironmentPackage({ tenant: "family-a" });
    await expect(
      verifyEnvironmentPackage({ ...envelope, payload: `${envelope.payload}A` }),
    ).rejects.toThrow("signature verification failed");
    await expect(
      verifyEnvironmentPackage({ ...envelope, signature: "0".repeat(64) }),
    ).rejects.toThrow("signature verification failed");
  });
});
