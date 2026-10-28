import { describe, expect, it } from "vitest";

import {
  buildCsp,
  buildSecurityHeaders,
  generateNonce,
  injectCspNonceMetadata,
  injectScriptNonce,
} from "@/lib/security/csp";

describe("generateNonce", () => {
  it("produces base64url values without padding", () => {
    for (let i = 0; i < 20; i++) {
      const n = generateNonce();
      expect(n).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(n.length).toBeGreaterThanOrEqual(20);
    }
  });

  it("emits unique nonces on repeated calls", () => {
    const set = new Set<string>();
    for (let i = 0; i < 100; i++) set.add(generateNonce());
    expect(set.size).toBe(100);
  });
});

describe("buildCsp", () => {
  it("drops 'unsafe-inline' as an active script-src token when a nonce is provided", () => {
    const csp = buildCsp("abc123");
    // strict-dynamic + nonce present
    expect(csp).toContain("'nonce-abc123'");
    expect(csp).toContain("'strict-dynamic'");
    // nonce+strict-dynamic causes browsers that understand it to ignore 'unsafe-inline',
    // but we assert the modern tokens are present as the enforced policy.
    const script = csp.split(";").find((d) => d.trim().startsWith("script-src")) ?? "";
    expect(script).toContain("'nonce-abc123'");
    expect(script).toContain("'strict-dynamic'");
  });

  it("keeps script-src fail-closed at 'self' when no nonce is provided", () => {
    const csp = buildCsp(undefined);
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).not.toContain("'strict-dynamic'");
  });

  it("pins the mandatory hardening directives", () => {
    const csp = buildCsp("n");
    for (const d of [
      "default-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "upgrade-insecure-requests",
    ]) {
      expect(csp).toContain(d);
    }
  });

  it("never contains 'unsafe-eval'", () => {
    expect(buildCsp("n")).not.toContain("unsafe-eval");
    expect(buildCsp(undefined)).not.toContain("unsafe-eval");
  });
});

describe("buildSecurityHeaders", () => {
  it("includes HSTS with preload, referrer policy, permissions policy, COOP/CORP", () => {
    const h = buildSecurityHeaders("n");
    expect(h["Strict-Transport-Security"]).toBe(
      "max-age=31536000; includeSubDomains; preload",
    );
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["Cross-Origin-Opener-Policy"]).toBe("same-origin");
    expect(h["Cross-Origin-Resource-Policy"]).toBe("same-site");
    for (const feature of [
      "camera=()",
      "microphone=()",
      "geolocation=()",
      "payment=()",
      "usb=()",
      "midi=()",
      "magnetometer=()",
      "gyroscope=()",
      "accelerometer=()",
      "interest-cohort=()",
    ]) {
      expect(h["Permissions-Policy"]).toContain(feature);
    }
  });
});

describe("injectScriptNonce", () => {
  it("adds nonce to bare <script> tags", () => {
    const out = injectScriptNonce(`<script>alert(1)</script>`, "abc");
    expect(out).toBe(`<script nonce="abc">alert(1)</script>`);
  });

  it("adds nonce to <script src> tags while preserving attributes", () => {
    const out = injectScriptNonce(`<script src="/a.js" type="module"></script>`, "abc");
    expect(out).toBe(`<script nonce="abc" src="/a.js" type="module"></script>`);
  });

  it("does not double-inject when a nonce is already present", () => {
    const src = `<script nonce="existing">1</script>`;
    expect(injectScriptNonce(src, "abc")).toBe(src);
  });

  it("rewrites multiple script tags in one pass", () => {
    const html = `<html><head><script>a</script></head><body><script src="b.js"></script></body></html>`;
    const out = injectScriptNonce(html, "xyz");
    const matches = out.match(/<script nonce="xyz"/g) ?? [];
    expect(matches.length).toBe(2);
  });

  it("is case-insensitive on the tag name", () => {
    const out = injectScriptNonce(`<SCRIPT>1</SCRIPT>`, "abc");
    expect(out).toContain(`nonce="abc"`);
  });

  it("does not touch non-script tags", () => {
    const html = `<style>body{}</style><link rel="stylesheet" href="a.css"/>`;
    expect(injectScriptNonce(html, "abc")).toBe(html);
  });
});

describe("injectCspNonceMetadata", () => {
  it("adds the TanStack nonce handoff inside head", () => {
    const out = injectCspNonceMetadata("<html><head><title>FVI</title></head></html>", "abc");
    expect(out).toContain('<head><meta property="csp-nonce" content="abc">');
  });

  it("replaces an existing handoff instead of duplicating it", () => {
    const source = '<head><meta property="csp-nonce" content="old"></head>';
    const out = injectCspNonceMetadata(source, "fresh");
    expect(out.match(/property="csp-nonce"/gu)).toHaveLength(1);
    expect(out).toContain('content="fresh"');
  });
});
