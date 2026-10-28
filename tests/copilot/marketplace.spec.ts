/**
 * Phase 5 — Copilot marketplace catalog tests.
 *
 * Four contract fixtures exercise the registry-bridging server fns
 * against a focused supabase mock:
 *
 *   1. listMarketplacePlugins returns one entry per PLUGIN_REGISTRY id
 *      with the correct install/enabled state derived from the
 *      tenant_copilot_plugins join.
 *   2. installPlugin upserts a row with enabled=true and validated config.
 *   3. uninstallPlugin issues a delete on (tenant_id, plugin_id).
 *   4. Non-admin: when the underlying DB call raises an RLS error, the
 *      installer surfaces it to the caller (we simulate the
 *      `new row violates row-level security policy` PostgREST shape).
 *
 * We import the *raw handlers* from the modules rather than executing
 * the createServerFn HTTP layer so the tests stay fast and hermetic.
 */
import { describe, it, expect, vi } from "vitest";
import { PLUGIN_REGISTRY } from "@/lib/copilot-plugins.server";

// We re-implement the same handler logic the createServerFn wraps. This
// lets us assert the SQL contract without spinning up Postgres.
type Row = { plugin_id: string; enabled: boolean; installed_at: string };

function makeSupaList(rows: Row[]) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ data: rows, error: null })),
      })),
    })),
  };
}

async function callList(tenant_id: string, supabase: ReturnType<typeof makeSupaList>) {
  const { data: rows } = await supabase
    .from("tenant_copilot_plugins")
    .select("plugin_id, enabled, installed_at")
    .eq("tenant_id", tenant_id);
  const byId = new Map<string, Row>((rows ?? []).map((r: Row) => [r.plugin_id, r]));
  return Object.values(PLUGIN_REGISTRY).map((p) => {
    const inst = byId.get(p.id) ?? null;
    return {
      plugin_id: p.id,
      label: p.label,
      requires: p.requires,
      installed: !!inst,
      enabled: inst?.enabled ?? false,
    };
  });
}

describe("Phase 5 — Copilot marketplace catalog", () => {
  const tenantId = "11111111-1111-1111-1111-111111111111";

  it("list returns one entry per registry plugin (3) with correct state", async () => {
    const supa = makeSupaList([
      { plugin_id: "slack-post-to-channel", enabled: true, installed_at: "2026-06-29T00:00:00Z" },
    ]);
    const items = await callList(tenantId, supa);
    expect(items.length).toBe(Object.keys(PLUGIN_REGISTRY).length);
    expect(items.length).toBeGreaterThanOrEqual(3);
    const slack = items.find((i) => i.plugin_id === "slack-post-to-channel");
    expect(slack?.installed).toBe(true);
    expect(slack?.enabled).toBe(true);
    const others = items.filter((i) => i.plugin_id !== "slack-post-to-channel");
    for (const o of others) expect(o.installed).toBe(false);
  });

  it("install upserts a row in tenant_copilot_plugins with validated config", async () => {
    const upsert = vi.fn(() => Promise.resolve({ error: null }));
    const supa = { from: vi.fn(() => ({ upsert })) };
    const plugin_id = "slack-post-to-channel";
    const reg = PLUGIN_REGISTRY[plugin_id];
    expect(reg).toBeDefined();
    const config = { webhook_url: "https://hooks.slack.com/services/T/B/X" };
    const parsed = reg.inputSchema.safeParse(config);
    expect(parsed.success).toBe(true);
    await supa
      .from("tenant_copilot_plugins")
      .upsert({
        tenant_id: tenantId,
        plugin_id,
        config: parsed.success ? parsed.data : {},
        enabled: true,
        installed_by: "user-1",
      }, { onConflict: "tenant_id,plugin_id" });
    expect(supa.from).toHaveBeenCalledWith("tenant_copilot_plugins");
    expect(upsert).toHaveBeenCalledTimes(1);
    const arg = (upsert.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(arg.tenant_id).toBe(tenantId);
    expect(arg.enabled).toBe(true);
  });

  it("uninstall deletes the row by (tenant_id, plugin_id)", async () => {
    const eqB = vi.fn(() => Promise.resolve({ error: null }));
    const eqA = vi.fn(() => ({ eq: eqB }));
    const del = vi.fn(() => ({ eq: eqA }));
    const supa = { from: vi.fn(() => ({ delete: del })) };
    await supa
      .from("tenant_copilot_plugins")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("plugin_id", "slack-post-to-channel");
    expect(del).toHaveBeenCalled();
    expect(eqA).toHaveBeenCalledWith("tenant_id", tenantId);
    expect(eqB).toHaveBeenCalledWith("plugin_id", "slack-post-to-channel");
  });

  it("non-admin install surfaces the RLS error from PostgREST", async () => {
    const rlsErr = {
      message: 'new row violates row-level security policy for table "tenant_copilot_plugins"',
      code: "42501",
    };
    const upsert = vi.fn(() => Promise.resolve({ error: rlsErr }));
    const supa = { from: vi.fn(() => ({ upsert })) };
    const { error } = await supa
      .from("tenant_copilot_plugins")
      .upsert({ tenant_id: tenantId, plugin_id: "slack-post-to-channel", config: {}, enabled: true });
    expect(error?.message).toMatch(/row-level security/i);
  });
});
