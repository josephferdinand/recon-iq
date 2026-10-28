// E3 — audit_log_chain actor enforcement.
// Pure unit version: emulates the trigger predicate to lock the contract.
import { describe, it, expect } from "vitest";

const SYSTEM_PREFIXES = ["cron.", "webhook.", "system.", "scim.", "retention.", "backup."];

function isSystemAction(row: { actor_user_id?: string | null; scope?: string; action: string }, sessionRole?: string) {
  if (row.actor_user_id) return true;
  if (sessionRole === "service_role") return true;
  if (row.scope === "system") return true;
  return SYSTEM_PREFIXES.some((p) => row.action.startsWith(p));
}

function emulateTrigger(row: { actor_user_id?: string | null; scope?: string; action: string }, sessionRole?: string) {
  if (!isSystemAction(row, sessionRole)) {
    throw new Error(`audit_log: actor_user_id required for non-system action "${row.action}"`);
  }
  return { ok: true };
}

describe("audit_log_chain actor enforcement", () => {
  it("explicit actor passes", () => {
    expect(emulateTrigger({ actor_user_id: "u1", scope: "tenant", action: "tenant.invite" }).ok).toBe(true);
  });

  it("missing actor on non-system action throws", () => {
    expect(() => emulateTrigger({ actor_user_id: null, scope: "tenant", action: "tenant.invite" })).toThrow(/actor_user_id required/);
  });

  it("cron.* with null actor is allowed (system action)", () => {
    expect(emulateTrigger({ actor_user_id: null, scope: "tenant", action: "cron.retention.purge" }).ok).toBe(true);
  });

  it("service_role session bypasses actor requirement", () => {
    expect(emulateTrigger({ actor_user_id: null, scope: "tenant", action: "tenant.invite" }, "service_role").ok).toBe(true);
  });
});
