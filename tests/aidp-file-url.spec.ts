import { describe, it, expect } from "vitest";
import { validateFileUrl } from "@/routes/api/public/aidp/extract";

describe("S-5 file_url path traversal defense", () => {
  it("rejects bucket/../other-bucket traversal even though URL collapses it", () => {
    const r = validateFileUrl("https://s3.amazonaws.com/bucket/../other-bucket/secret.pdf");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("path_traversal");
  });

  it("normalizes single-dot segment", () => {
    const r = validateFileUrl("https://s3.amazonaws.com/bucket/./secret.pdf");
    expect(r.ok).toBe(true);
  });

  it("rejects percent-encoded traversal", () => {
    const r = validateFileUrl("https://s3.amazonaws.com/bucket/%2E%2E/other/secret.pdf");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("path_traversal");
  });

  it("accepts a clean https URL", () => {
    const r = validateFileUrl("https://s3.amazonaws.com/bucket/clean-key.pdf");
    expect(r.ok).toBe(true);
  });

  it("rejects non-https", () => {
    const r = validateFileUrl("http://s3.amazonaws.com/bucket/clean-key.pdf");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("file_url_must_be_https");
  });
});
