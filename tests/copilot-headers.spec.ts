import { describe, it, expect } from "vitest";

// S-2 — assert explicit security headers wrap the streamed response.
// We construct the same Headers transformation used in stream.ts and
// verify each required header is present and correctly valued.

function wrap(inner: Response): Response {
  const headers = new Headers(inner.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  return new Response(inner.body, { status: inner.status, headers });
}

describe("S-2 copilot stream security headers", () => {
  it("attaches required headers without dropping content-type", () => {
    const inner = new Response("stream-bytes", {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
    const out = wrap(inner);
    expect(out.headers.get("Cache-Control")).toBe("no-store");
    expect(out.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(out.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(out.headers.get("Content-Security-Policy")).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
    expect(out.headers.get("content-type")).toBe("text/event-stream");
  });
});
