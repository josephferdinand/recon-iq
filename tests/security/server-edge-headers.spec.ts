import { describe, expect, it } from "vitest";
import { hardenEdgeResponse } from "@/server";

describe("custom Cloudflare server edge hardening", () => {
  it("adds a nonce to HTML scripts and enforces the matching CSP", async () => {
    const response = await hardenEdgeResponse(
      new Response("<html><script>boot()</script></html>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
      new Request("https://app.reconiq.example/"),
    );
    const body = await response.text();
    const nonce = /<script nonce="([^"]+)"/.exec(body)?.[1];
    expect(nonce).toBeTruthy();
    expect(response.headers.get("content-security-policy")).toContain(`'nonce-${nonce}'`);
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("adds security headers without rewriting JSON bodies", async () => {
    const response = await hardenEdgeResponse(
      Response.json({ ok: true }),
      new Request("https://app.reconiq.example/api/public/status"),
    );
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get("content-security-policy")).toContain("script-src 'self'");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
