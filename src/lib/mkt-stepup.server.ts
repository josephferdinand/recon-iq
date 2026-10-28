/**
 * MFA step-up gate for destructive marketing-admin write operations.
 *
 * Every mkt_admin mutation must be preceded by a Supabase Auth session that
 * has been upgraded to `aal2` (a valid MFA challenge in the current
 * lifetime of the access token). Success and failure attempts are both
 * appended to `mkt_content_audit_log` so security has a full timeline of
 * privileged-write attempts, including denied ones.
 *
 * Usage inside a `createServerFn` handler that already ran the
 * `requireSupabaseAuth` middleware:
 *
 *   await requireMktStepUp(context, { entity_type: "site_theme", action: "activate" });
 */

import { logMktChange, type MktAuditEntity, type MktAuditAction } from "./mkt-audit.server";

type StepUpCtx = {
  userId: string;
  claims?: Record<string, unknown> | null | undefined;
};

export interface RequireMktStepUpOptions {
  /** Audit entity being touched (for the failure record). */
  entity_type: MktAuditEntity;
  /** Description of the guarded action (e.g. "activate"). */
  action: MktAuditAction;
  /** Optional target key for the audit row. */
  entity_key?: string | null;
  /** Optional summary override for the failure audit row. */
  summary?: string;
  /**
   * Escape hatch for environments where MFA has not been rolled out yet.
   * When `MKT_STEPUP_ENFORCED=false`, we log `stepup_success` with a
   * `bypass:true` marker instead of throwing. Defaults to enforcement ON.
   */
  allowBypassEnv?: string;
}

const ENFORCED_DEFAULT = "true";

function isEnforced(envName: string | undefined): boolean {
  const raw = envName ? (process.env[envName] ?? ENFORCED_DEFAULT) : ENFORCED_DEFAULT;
  return String(raw).toLowerCase() !== "false";
}

/** Extract auth assurance level from Supabase JWT claims. */
function currentAal(claims: Record<string, unknown> | null | undefined): string | null {
  if (!claims) return null;
  const aal = claims["aal"];
  if (typeof aal === "string") return aal;
  const amr = claims["amr"];
  if (Array.isArray(amr)) {
    // amr entries look like { method: "totp", timestamp: ... }; presence of
    // a factor other than "password" implies aal2.
    for (const entry of amr) {
      if (entry && typeof entry === "object") {
        const method = (entry as { method?: unknown }).method;
        if (typeof method === "string" && method !== "password" && method !== "otp") {
          return "aal2";
        }
      }
    }
  }
  return null;
}

export async function requireMktStepUp(
  context: StepUpCtx,
  opts: RequireMktStepUpOptions,
): Promise<void> {
  const enforced = isEnforced(opts.allowBypassEnv ?? "MKT_STEPUP_ENFORCED");
  const aal = currentAal(context.claims ?? null);
  const actorEmail =
    (context.claims as { email?: string } | undefined)?.email ?? null;

  if (aal === "aal2") {
    await logMktChange({
      entity_type: opts.entity_type,
      entity_key: opts.entity_key ?? null,
      action: "stepup_success",
      actor_id: context.userId,
      actor_email: actorEmail,
      after: { guarded_action: opts.action, aal } as never,
      summary: opts.summary ?? `Step-up (aal2) passed for ${opts.action}`,
    });
    return;
  }

  await logMktChange({
    entity_type: opts.entity_type,
    entity_key: opts.entity_key ?? null,
    action: "stepup_failed",
    actor_id: context.userId,
    actor_email: actorEmail,
    after: { guarded_action: opts.action, aal: aal ?? "aal1", enforced } as never,
    summary:
      opts.summary ??
      `Step-up required (aal2) for ${opts.action} — caller aal="${aal ?? "aal1"}"`,
  });

  if (!enforced) return; // dev/rollout mode

  // Structured error so the client can prompt for MFA challenge.
  throw new Response(
    JSON.stringify({
      code: "mfa_required",
      message: "Multi-factor step-up (aal2) required for this action.",
      entity_type: opts.entity_type,
      action: opts.action,
    }),
    { status: 401, headers: { "content-type": "application/json" } },
  );
}
