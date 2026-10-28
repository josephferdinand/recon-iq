// C-1 — PII policy bump recorder.
//
// `PII_POLICY_VERSION` in src/lib/pii-redact.ts is a compile-time constant.
// When it is bumped, the new code path defined here notifies the audit
// system by inserting a row into `pii_policy_changes` via the
// SECURITY DEFINER function `public.record_pii_policy_change`.
//
// Call once at process bootstrap (or on demand from an admin route).
// Idempotent: the DB function returns the existing row id when the same
// `new_version` has already been recorded.

import { PII_POLICY_VERSION } from "./pii-redact";

export interface RecordPiiPolicyChangeArgs {
  previous: string | null;
  next: string;
  summary: string;
  initiatedBy?: string | null;
}

interface SupabaseLike {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
}

export async function recordPiiPolicyChange(
  supabase: SupabaseLike,
  args: RecordPiiPolicyChangeArgs,
): Promise<{ id: string | null; error?: string }> {
  if (!args.next || args.next.length === 0) {
    return { id: null, error: "new_version required" };
  }
  const { data, error } = await supabase.rpc("record_pii_policy_change", {
    _previous: args.previous,
    _new: args.next,
    _summary: args.summary,
    _initiated_by: args.initiatedBy ?? null,
  });
  if (error) return { id: null, error: error.message };
  return { id: (data as string | null) ?? null };
}

/**
 * Bootstrap hook: ensure the current `PII_POLICY_VERSION` has a row in
 * `pii_policy_changes`. Safe to call repeatedly. Caller supplies a summary
 * to be stored with the row when this is the first time we see this version.
 */
export async function ensureCurrentPiiPolicyRecorded(
  supabase: SupabaseLike,
  opts: { previous?: string | null; summary?: string; initiatedBy?: string | null } = {},
): Promise<{ id: string | null; error?: string }> {
  return recordPiiPolicyChange(supabase, {
    previous: opts.previous ?? null,
    next: PII_POLICY_VERSION,
    summary: opts.summary ?? `Policy version ${PII_POLICY_VERSION} active.`,
    initiatedBy: opts.initiatedBy ?? null,
  });
}
