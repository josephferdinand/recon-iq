/**
 * Lightweight, fire-and-forget CTA event tracking for enterprise CTAs
 * (buyer's guide, due-diligence pack, comparison downloads).
 *
 * All calls are best-effort — they never throw and never block the UI.
 */

export type CtaEventType = "view" | "click" | "form_submit" | "pack_download";

export interface TrackCtaOptions {
  /** Stable identifier for the CTA. Keep in lowercase_snake_case. */
  cta_id: string;
  /** High-level context: page section or campaign name (e.g. "home_hero", "security_page"). */
  source?: string;
  /** Optional lead id if the event is tied to a submitted lead. */
  lead_id?: string;
  /** Any additional structured metadata (kept small). */
  meta?: Record<string, unknown>;
  /** Explicit region override (ISO country code). If omitted, edge-derived. */
  region?: string;
}

const SESSION_KEY = "fvi_cta_session_id";
const REGION_KEY = "fvi_cta_region";
const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;

function getSessionId(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    let sid = window.sessionStorage.getItem(SESSION_KEY);
    if (!sid) {
      sid =
        (typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`);
      window.sessionStorage.setItem(SESSION_KEY, sid);
    }
    return sid;
  } catch {
    return undefined;
  }
}

function inferRegion(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const cached = window.sessionStorage.getItem(REGION_KEY);
    if (cached) return cached;
  } catch {
    /* ignore */
  }
  try {
    // Best-effort locale-derived hint (e.g. "en-GB" -> "GB"). The server
    // still prefers Cloudflare's cf-ipcountry header when available.
    const lang = navigator.language || (navigator.languages && navigator.languages[0]);
    const match = lang && lang.match(/[-_]([A-Z]{2})$/i);
    if (match) {
      const region = match[1].toUpperCase();
      try {
        window.sessionStorage.setItem(REGION_KEY, region);
      } catch {
        /* ignore */
      }
      return region;
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

function getUtm(): Record<string, string> | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const params = new URLSearchParams(window.location.search);
    const out: Record<string, string> = {};
    for (const k of UTM_KEYS) {
      const v = params.get(k);
      if (v) out[k] = v.slice(0, 200);
    }
    return Object.keys(out).length ? out : undefined;
  } catch {
    return undefined;
  }
}

export function trackCtaEvent(event_type: CtaEventType, opts: TrackCtaOptions): void {
  if (typeof window === "undefined") return;
  try {
    const payload = {
      event_type,
      cta_id: opts.cta_id,
      source: opts.source,
      page_path: window.location.pathname,
      referrer: document.referrer || undefined,
      region: opts.region ?? inferRegion(),
      session_id: getSessionId(),
      lead_id: opts.lead_id,
      utm: getUtm(),
      meta: opts.meta,
    };
    const body = JSON.stringify(payload);
    const url = "/api/public/mkt-cta-events";
    // Prefer sendBeacon so navigations (e.g. clicking a <Link>) still deliver.
    if (typeof navigator !== "undefined" && "sendBeacon" in navigator) {
      const blob = new Blob([body], { type: "application/json" });
      const ok = navigator.sendBeacon(url, blob);
      if (ok) return;
    }
    void fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {
      /* swallow */
    });
  } catch {
    /* swallow */
  }
}
