/**
 * Copilot approval / cancel endpoint.
 *
 * POST /api/copilot/approve
 *   body: { tenant_id, action_id, confirmation_token, mode: 'approve' | 'cancel', reason? }
 *
 * - `approve` consumes the single-use token, enforces 4-eyes via the
 *   shared `executeConfirmedAction()` helper, and runs the real mutation.
 * - `cancel`  marks the pending action as rejected without mutating data.
 *
 * Requires a Supabase bearer token; RLS scopes the request to the caller.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import {
  executeConfirmedAction,
  cancelPendingAction,
} from "@/lib/agent-write-tools.server";

const Body = z.object({
  tenant_id: z.string().uuid(),
  action_id: z.string().uuid(),
  confirmation_token: z.string().min(8).optional(),
  mode: z.enum(["approve", "cancel"]).default("approve"),
  reason: z.string().max(500).optional(),
});

// LL-066 + LL-073 — Validate Bearer JWT SHAPE before any downstream work.
// A real Supabase JWT has three base64url segments (header.payload.signature).
// Reject anything else with 401 immediately so we don't fall through to
// `createClient` and surface a misleading 500 ("supabaseUrl is required").
function bearer(req: Request): string | null {
  const m = (req.headers.get("authorization") ?? "").match(/^bearer\s+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i);
  return m ? m[1] : null;
}

export async function handleCopilotApprove(req: Request): Promise<Response> {
  const token = bearer(req);
  if (!token) return new Response("Unauthorized", { status: 401 });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    return Response.json({ error: "server_misconfigured" }, { status: 500 });
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const supabase = createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
      global: { headers: { Authorization: `Bearer ${token}` } },
    },
  );
  const { data: u } = await supabase.auth.getUser();
  const userId = u?.user?.id;
  if (!userId) return new Response("Unauthorized", { status: 401 });

  try {
    if (body.mode === "cancel") {
      const out = await cancelPendingAction(supabase, userId, {
        tenantId: body.tenant_id,
        actionId: body.action_id,
        reason: body.reason,
      });
      return Response.json(out);
    }
    if (!body.confirmation_token) {
      return new Response("confirmation_token required", { status: 400 });
    }
    const out = await executeConfirmedAction(supabase, userId, {
      tenantId: body.tenant_id,
      actionId: body.action_id,
      confirmationToken: body.confirmation_token,
    });
    return Response.json(out);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status =
      msg === "agent.token_expired" || msg === "agent.token_invalid"
        ? 410
        : msg === "agent.token_already_used" || msg === "agent.action_not_pending"
        ? 409
        : msg === "agent.self_approve_blocked"
        ? 403
        : 400;
    return Response.json({ error: msg }, { status });
  }
}

export const Route = createFileRoute("/api/copilot/approve")({
  server: {
    handlers: {
      POST: async ({ request }) => handleCopilotApprove(request),
    },
  },
});
