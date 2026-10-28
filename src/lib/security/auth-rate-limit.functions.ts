/**
 * Per-IP auth rate limit — public server function, no auth required (it is
 * called before sign-in). Uses `public.rate_limit_buckets` to enforce a
 * sliding-window ceiling on submissions per IP.
 *
 * Pentest ref: P-L-03 (per-IP rate limit on `/auth` submit).
 *
 * Contract:
 *   - Bucket key: `auth:<sha256(ip)>` (short hash, no raw PII stored).
 *   - Window: 5 minutes.
 *   - Ceiling: 10 attempts / window.
 *   - Returns { allowed, remaining, retryAfterSec }.
 *   - The DB write path is BYPASSED silently on failure (fail-open) so a
 *     database blip cannot lock everyone out of sign-in. The retry-cap only
 *     applies when the bucket read succeeds.
 */

import { createServerFn } from "@tanstack/react-start";
import { createHash } from "node:crypto";
import { z } from "zod";

const WINDOW_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 10;

const Input = z.object({
  // The client passes nothing sensitive; the server derives the IP from
  // request headers set by the edge. An optional label lets us keep separate
  // counters for signin vs signup vs password-reset without extra tables.
  label: z.enum(["signin", "signup", "reset"]).default("signin"),
});

export const checkAuthRateLimit = createServerFn({ method: "POST" })
  .validator((data: unknown) => Input.parse(data ?? {}))
  .handler(async ({ data }) => {
    const { getRequest } = await import("@tanstack/react-start/server");
    const req = getRequest();
    const ip =
      req.headers.get("cf-connecting-ip") ??
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("x-real-ip") ??
      "unknown";

    const ipHash = createHash("sha256").update(ip).digest("hex").slice(0, 16);
    const bucketKey = `auth:${data.label}:${ipHash}`;
    const now = new Date();
    const windowStart = new Date(Math.floor(now.getTime() / WINDOW_MS) * WINDOW_MS);

    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      const { data: existing } = await supabaseAdmin
        .from("rate_limit_buckets")
        .select("id, count")
        .eq("bucket_key", bucketKey)
        .eq("window_start", windowStart.toISOString())
        .maybeSingle();

      const current = existing?.count ?? 0;
      const remaining = Math.max(0, MAX_ATTEMPTS - current - 1);
      const allowed = current < MAX_ATTEMPTS;

      if (existing) {
        await supabaseAdmin
          .from("rate_limit_buckets")
          .update({ count: current + 1 })
          .eq("id", existing.id);
      } else {
        await supabaseAdmin.from("rate_limit_buckets").insert({
          bucket_key: bucketKey,
          window_start: windowStart.toISOString(),
          count: 1,
        });
      }

      const retryAfterSec = Math.max(
        1,
        Math.ceil((windowStart.getTime() + WINDOW_MS - now.getTime()) / 1000),
      );

      return {
        allowed,
        remaining,
        retryAfterSec: allowed ? 0 : retryAfterSec,
      };
    } catch {
      // Fail-open: never block sign-in because the rate-limit table is down.
      return { allowed: true, remaining: MAX_ATTEMPTS, retryAfterSec: 0 };
    }
  });
