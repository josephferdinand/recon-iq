/**
 * D1 — Server-side rate limiter. Uses the SECURITY DEFINER rate_limit_hit()
 * function to atomically increment a counter per (key, window).
 *
 * NOTE: This file is server-side only. Import lazily inside handlers if you
 * are unsure whether your module ships to the client.
 */

import { setResponseHeader, setResponseStatus } from "@tanstack/react-start/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type RateLimitResult = {
  allowed: boolean;
  current: number;
  retryAfterSeconds: number;
};

export type RateLimitErrorCode = "rate_limit_exceeded" | "rate_limit_unavailable";

const MAX_RETRY_AFTER_SECONDS = 86_400;
const RATE_LIMIT_TRANSPORT_MARKER = "X-FVI-Rate-Limit-Error";
const RATE_LIMIT_UNAVAILABLE_MESSAGE =
  "Rate limiting is temporarily unavailable. Try again later.";

function boundedRetryAfter(value: unknown, minimum: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return minimum;
  return Math.min(MAX_RETRY_AFTER_SECONDS, Math.max(minimum, Math.ceil(numeric)));
}

function nonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

export class RateLimitError extends Error {
  readonly code: RateLimitErrorCode;
  readonly statusCode: 429 | 503;
  readonly retryAfterSeconds: number;

  constructor(code: RateLimitErrorCode, retryAfterSeconds = 0) {
    const boundedRetry =
      code === "rate_limit_exceeded" ? boundedRetryAfter(retryAfterSeconds, 1) : 0;
    super(
      code === "rate_limit_exceeded"
        ? `Rate limit exceeded. Try again in ${boundedRetry} seconds.`
        : RATE_LIMIT_UNAVAILABLE_MESSAGE,
    );
    this.name = "RateLimitError";
    this.code = code;
    this.statusCode = code === "rate_limit_exceeded" ? 429 : 503;
    this.retryAfterSeconds = boundedRetry;
  }
}

export function toRateLimitError(error: unknown) {
  return error instanceof RateLimitError
    ? error
    : new RateLimitError("rate_limit_unavailable");
}

/**
 * Atomically increment a bucket and return whether the call is allowed.
 *   supabase: authenticated supabase client from context (kept for API compatibility)
 *   key:      stable bucket key (e.g. `recon.run:tenant:<id>:user:<id>`)
 *   windowSeconds: bucket width (3600 = 1h)
 *   limit:    max hits per window
 */
export async function checkRateLimit(
  _supabase: SupabaseClient,
  key: string,
  windowSeconds: number,
  limit: number,
): Promise<RateLimitResult> {
  try {
    const result = await supabaseAdmin.rpc("rate_limit_hit", {
      _key: key,
      _window_seconds: windowSeconds,
      _limit: limit,
    });
    if (result.error) throw new RateLimitError("rate_limit_unavailable");

    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!row || typeof row.allowed !== "boolean") {
      throw new RateLimitError("rate_limit_unavailable");
    }
    const current = nonNegativeInteger(row.current_count);
    const retryAfterSeconds = nonNegativeInteger(row.retry_after_seconds);
    if (current === null || retryAfterSeconds === null) {
      throw new RateLimitError("rate_limit_unavailable");
    }
    return {
      allowed: row.allowed,
      current,
      retryAfterSeconds: boundedRetryAfter(retryAfterSeconds, 0),
    };
  } catch (error) {
    console.error("[rate-limit] atomic check unavailable");
    throw toRateLimitError(error);
  }
}

async function recordRateLimitDenial(
  supabase: SupabaseClient,
  key: string,
  windowSeconds: number,
  limit: number,
  current: number,
  ctx: { tenant_id?: string; user_id?: string; event_type?: string },
) {
  try {
    const result = await supabase.from("security_events").insert({
      tenant_id: ctx.tenant_id ?? null,
      user_id: ctx.user_id ?? null,
      event_type: ctx.event_type ?? "rate_limit.exceeded",
      severity: "warning",
      context: { key, limit, window_seconds: windowSeconds, current },
    });
    if (result?.error) console.error("[rate-limit] denial audit unavailable");
  } catch {
    console.error("[rate-limit] denial audit unavailable");
  }
}

export async function enforceRateLimit(
  supabase: SupabaseClient,
  key: string,
  windowSeconds: number,
  limit: number,
  ctx?: { tenant_id?: string; user_id?: string; event_type?: string },
): Promise<void> {
  const r = await checkRateLimit(supabase, key, windowSeconds, limit);
  if (!r.allowed) {
    if (ctx) {
      await recordRateLimitDenial(supabase, key, windowSeconds, limit, r.current, ctx);
    }
    throw new RateLimitError("rate_limit_exceeded", r.retryAfterSeconds);
  }
}

export async function enforceServerFnRateLimit(
  supabase: SupabaseClient,
  key: string,
  windowSeconds: number,
  limit: number,
  ctx?: { tenant_id?: string; user_id?: string; event_type?: string },
): Promise<void> {
  try {
    await enforceRateLimit(supabase, key, windowSeconds, limit, ctx);
  } catch (error) {
    const rateLimitError = toRateLimitError(error);
    setResponseStatus(rateLimitError.statusCode);
    if (rateLimitError.code === "rate_limit_exceeded") {
      setResponseHeader(RATE_LIMIT_TRANSPORT_MARKER, "1");
      setResponseHeader("Retry-After", String(rateLimitError.retryAfterSeconds));
    }
    throw rateLimitError;
  }
}
