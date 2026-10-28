// P-M-01: nonce-based Content-Security-Policy for scripts.
//
// - Every SSR HTML response gets a fresh, base64-url nonce.
// - Every <script> tag emitted by SSR is rewritten to carry that nonce.
// - CSP's script-src drops 'unsafe-inline' and pins to the nonce, with
//   'strict-dynamic' so nonced loaders may pull additional scripts.
// - style-src retains 'unsafe-inline' — Radix, Tailwind arbitrary-value
//   utilities, and Motion inline transforms cannot be hashed without a
//   compile-time collector. Documented as an accepted residual in
//   docs/pentest/RESIDUAL_RISK_REGISTER.md.

export type CspOptions = { nonce?: string; reportOnly?: boolean };

export function generateNonce(): string {
  // Web Crypto is available in the Cloudflare Workers runtime and in Node 20+.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // base64url without padding — CSP-safe.
  let b64 = "";
  if (typeof btoa === "function") {
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    b64 = btoa(s);
  } else {
    b64 = Buffer.from(bytes).toString("base64");
  }
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function buildCsp(nonce: string | undefined): string {
  // When a nonce is present, 'strict-dynamic' tells supporting browsers to
  // ignore 'unsafe-inline' for script-src. We intentionally omit it so that
  // browsers that do NOT support strict-dynamic still reject inline scripts
  // rather than silently allowing them. Legacy browser support that requires
  // inline scripts should use a build-time hash collector instead.
  const scriptSrc = nonce
    ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`
    : "script-src 'self'";

  return [
    "default-src 'self'",
    "img-src 'self' data: blob: https:",
    // style-src retains 'unsafe-inline' — required for Tailwind arbitrary-value
    // utilities, Radix UI inline transforms, and Motion CSS. Documented residual
    // in docs/pentest/RESIDUAL_RISK_REGISTER.md.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    scriptSrc,
    "connect-src 'self' https://*.supabase.co https://*.supabase.in wss://*.supabase.co https://*.reconiq.example https://connector-gateway.meta.dev",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "upgrade-insecure-requests",
  ].join("; ");
}

/**
 * Inject nonce attribute on every <script> tag that does not already carry
 * one. Idempotent, HTML-safe: only rewrites the opening tag prefix and never
 * touches attribute values or the script body.
 */
export function injectScriptNonce(html: string, nonce: string): string {
  return html.replace(/<script(\s[^>]*)?>/gi, (match) => {
    if (/\snonce=/i.test(match)) return match;
    // Insert nonce right after `<script`.
    return match.replace(/^<script/i, `<script nonce="${nonce}"`);
  });
}

/** Give TanStack's document hydrator the nonce that was added at the edge. */
export function injectCspNonceMetadata(html: string, nonce: string): string {
  const meta = `<meta property="csp-nonce" content="${nonce}">`;
  const existing = /<meta\s+[^>]*property=["']csp-nonce["'][^>]*>/iu;
  if (existing.test(html)) return html.replace(existing, meta);
  return html.replace(/<head(\s[^>]*)?>/iu, (head) => `${head}${meta}`);
}

export function buildSecurityHeaders(nonce?: string): Record<string, string> {
  return {
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy":
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), midi=(), magnetometer=(), gyroscope=(), accelerometer=(), interest-cohort=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-site",
    "Content-Security-Policy": buildCsp(nonce),
  };
}
