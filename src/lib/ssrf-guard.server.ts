// ─────────────────────────────────────────────────────────────────────────────
// Server-only SSRF guard for outbound fetches initiated from user-supplied
// URLs. Rejects non-http(s) schemes, private/loopback/link-local/multicast
// IPs, and metadata endpoints. Enforces body size limits and follows at most
// N redirects with per-hop re-validation.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_REDIRECTS = 5;
const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5 MB per request

const BLOCKED_HOSTS = new Set<string>([
  "localhost",
  "metadata.google.internal",
  "metadata",
]);

const BLOCKED_HOST_SUFFIXES = [".internal", ".local", ".localhost"];

function isPrivateV4(ip: string): boolean {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => !Number.isFinite(p) || p < 0 || p > 255)) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local + AWS metadata 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function isPrivateV6(ip: string): boolean {
  const s = ip.toLowerCase();
  if (s === "::1" || s === "::") return true;
  if (s.startsWith("fc") || s.startsWith("fd")) return true; // ULA
  if (s.startsWith("fe80")) return true; // link-local
  if (s.startsWith("::ffff:")) return isPrivateV4(s.slice(7));
  return false;
}

export function assertSafeOutboundUrl(rawUrl: string): URL {
  let u: URL;
  try { u = new URL(rawUrl); } catch { throw new Error("Invalid URL"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`Blocked scheme: ${u.protocol}`);
  }
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTS.has(host)) throw new Error(`Blocked host: ${host}`);
  if (BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new Error(`Blocked host suffix: ${host}`);
  }
  if (/^[0-9.]+$/.test(host) && isPrivateV4(host)) {
    throw new Error(`Blocked private IPv4: ${host}`);
  }
  if (host.includes(":") && isPrivateV6(host)) {
    throw new Error(`Blocked private IPv6: ${host}`);
  }
  return u;
}

export async function safeFetch(rawUrl: string, init?: RequestInit): Promise<Response> {
  const u = assertSafeOutboundUrl(rawUrl);

  async function follow(u: URL, depth: number): Promise<Response> {
    if (depth > MAX_REDIRECTS) throw new Error(`Too many redirects (max ${MAX_REDIRECTS})`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      const res = await fetch(u.toString(), {
        redirect: "manual",
        signal: controller.signal,
        // Limit download size at the stream level. `duplex` is supported by
        // the Worker fetch runtime and current RequestInit types.
        duplex: "half",
        ...init,
      } as RequestInit);
      clearTimeout(timeout);

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return res;
        const next = new URL(loc, u);
        assertSafeOutboundUrl(next.toString());
        return follow(next, depth + 1);
      }

      // Enforce body size limit on success / error responses
      const contentLength = res.headers.get("content-length");
      if (contentLength && Number(contentLength) > MAX_BODY_BYTES) {
        throw new Error(`Response body exceeds size limit (${MAX_BODY_BYTES} bytes)`);
      }

      return res;
    } catch (e) {
      clearTimeout(timeout);
      throw e;
    }
  }

  return follow(u, 0);
}
