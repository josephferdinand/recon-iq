// Server-only helper for writing site-content audit rows.
// Callers are already inside an authenticated createServerFn handler.

type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;

export type MktAuditEntity =
  | "homepage_section"
  | "site_logo"
  | "llm_provider"
  | "kb_source"
  | "admin_role"
  | "chatbot_prompt"
  | "appointment_type"
  | "lead"
  | "site_theme"
  | "theme_approval"
  | "mkt_bootstrap";

export type MktAuditAction =
  | "create" | "update" | "delete" | "reset"
  | "activate" | "schedule" | "rollback" | "archive"
  | "stepup_success" | "stepup_failed"
  | "bootstrap_success" | "bootstrap_denied"
  | "request" | "approve" | "reject" | "cancel";

/**
 * Snapshot of the actor's identity and effective marketing permissions at
 * the exact moment the audited change happened. Persisted alongside the
 * before/after payload so reviewers can see WHO acted and under WHICH
 * privileges, even if the actor's roles change later.
 */
export interface MktActorContext {
  user_id: string;
  email: string | null;
  roles: string[];
  is_platform_admin: boolean;
  /** Where the effective permissions came from (e.g. "assertMktRole", "platform_admin_bypass", "bootstrap"). */
  source?: string;
}

export interface LogMktChangeArgs {
  entity_type: MktAuditEntity;
  entity_key?: string | null;
  action: MktAuditAction;
  actor_id: string;
  actor_email?: string | null;
  actor_context?: MktActorContext | null;
  before?: Json | null;
  after?: Json | null;
  summary?: string | null;
}

/**
 * Resolve the actor's effective marketing permissions from a server-fn
 * context. Safe to call multiple times; failures degrade gracefully to an
 * empty role list rather than blocking the audit write.
 */
export async function resolveMktActorContext(
  context: {
    userId: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: any;
    claims?: Record<string, unknown> | null | undefined;
  },
  overrides?: { roles?: string[]; source?: string },
): Promise<MktActorContext> {
  const email = (context.claims as { email?: string } | undefined)?.email ?? null;
  let roles: string[] = overrides?.roles ?? [];
  let isPlatformAdmin = false;
  try {
    if (!overrides?.roles) {
      const { data } = await context.supabase
        .from("mkt_admin_roles").select("role").eq("user_id", context.userId);
      roles = ((data ?? []) as { role: string }[]).map((r) => r.role);
    }
  } catch { /* leave roles empty */ }
  try {
    const { data } = await context.supabase.rpc("is_platform_admin", { _user_id: context.userId });
    isPlatformAdmin = Boolean(data);
  } catch { /* leave false */ }
  if (isPlatformAdmin && !roles.includes("super_admin")) roles = ["super_admin", ...roles];
  return {
    user_id: context.userId,
    email,
    roles: Array.from(new Set(roles)),
    is_platform_admin: isPlatformAdmin,
    source: overrides?.source,
  };
}

/**
 * Append a row to public.mkt_content_audit_log via the SECURITY DEFINER
 * helper. Failures are swallowed so audit gaps never break a live write —
 * the failure is logged server-side for investigation.
 */
export async function logMktChange(args: LogMktChangeArgs): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("mkt_content_audit_log" as any)
      .insert({
        entity_type: args.entity_type,
        entity_key: args.entity_key ?? null,
        action: args.action,
        actor_id: args.actor_id,
        actor_email: args.actor_email ?? args.actor_context?.email ?? null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        actor_context: (args.actor_context ?? null) as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        before: (args.before ?? null) as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        after: (args.after ?? null) as any,
        summary: args.summary ?? null,
      });
    if (error) {
      // eslint-disable-next-line no-console
      console.error("[mkt-audit] insert failed", error.message, args);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[mkt-audit] unexpected", err);
  }
}
