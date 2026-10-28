import { describe, it, expect, vi } from "vitest";
import { recordPiiPolicyChange, ensureCurrentPiiPolicyRecorded } from "@/lib/pii-policy-change.server";
import { PII_POLICY_VERSION } from "@/lib/pii-redact";

function mkSupabase(rpcImpl?: (fn: string, args: any) => Promise<any>) {
  const calls: Array<{ fn: string; args: any }> = [];
  const supabase = {
    rpc: async (fn: string, args: any) => {
      calls.push({ fn, args });
      if (rpcImpl) return rpcImpl(fn, args);
      return { data: "00000000-0000-0000-0000-000000000001", error: null };
    },
  };
  return { supabase: supabase as any, calls };
}

describe("C-1 pii_policy_changes recorder", () => {
  it("invokes record_pii_policy_change with the supplied previous/next/summary", async () => {
    const { supabase, calls } = mkSupabase();
    const r = await recordPiiPolicyChange(supabase, {
      previous: "pii-policy@1",
      next: "pii-policy@2",
      summary: "Added passport-number regex; tightened phone matcher.",
      initiatedBy: "user-1",
    });
    expect(r.id).toBe("00000000-0000-0000-0000-000000000001");
    expect(calls).toHaveLength(1);
    expect(calls[0].fn).toBe("record_pii_policy_change");
    expect(calls[0].args).toEqual({
      _previous: "pii-policy@1",
      _new: "pii-policy@2",
      _summary: "Added passport-number regex; tightened phone matcher.",
      _initiated_by: "user-1",
    });
  });

  it("rejects empty new_version", async () => {
    const { supabase, calls } = mkSupabase();
    const r = await recordPiiPolicyChange(supabase, {
      previous: "pii-policy@1",
      next: "",
      summary: "noop",
    });
    expect(r.id).toBeNull();
    expect(r.error).toMatch(/new_version required/);
    expect(calls).toHaveLength(0);
  });

  it("ensureCurrentPiiPolicyRecorded uses the current compile-time constant", async () => {
    const { supabase, calls } = mkSupabase();
    await ensureCurrentPiiPolicyRecorded(supabase, {
      previous: null,
      summary: "Initial registration of policy.",
    });
    expect(calls[0].args._new).toBe(PII_POLICY_VERSION);
    expect(calls[0].args._previous).toBeNull();
  });

  it("propagates DB-side errors", async () => {
    const { supabase } = mkSupabase(async () => ({
      data: null,
      error: { message: "permission denied" },
    }));
    const r = await recordPiiPolicyChange(supabase, {
      previous: null,
      next: "pii-policy@9",
      summary: "x",
    });
    expect(r.id).toBeNull();
    expect(r.error).toBe("permission denied");
  });
});
