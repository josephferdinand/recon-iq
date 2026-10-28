import { describe, it, expect, vi } from "vitest";
const stubs = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc: stubs.rpc }) }));
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => {
  let parse = (value: any) => value; const chain: any = { validator: (validator: any) => { parse = validator; return chain; },
    handler: (handler: any) => (args: any = {}) => handler({ data: parse(args.data) }) }; return chain;
} }));
vi.mock("@/lib/status-token-signing.server", () => ({ verifyStatusToken: async () => null }));
import { subscribeToStatus, confirmStatusSubscription } from "@/lib/status.functions";
describe("status pending consent public response", () => {
  it("does not give the caller confirmation/unsubscribe capabilities or claim a send", async () => {
    vi.stubEnv("SUPABASE_URL", "https://fixture.invalid"); vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "synthetic-fixture-only");
    stubs.rpc.mockReturnValue({ abortSignal: async () => ({ error: null }) });
    const result = await subscribeToStatus({ data: { email: "fixture@example.invalid", component_keys: [] } });
    expect(result).toEqual({ ok: true, consent_state: "pending_confirmation", confirmation_delivery: "not_verified" });
    expect(JSON.stringify(result)).not.toMatch(/confirm_token|unsubscribe_token|[a-f0-9]{64}/);
    vi.unstubAllEnvs();
  });
  it("rejects invalid confirmation tokens before any subscription RPC", async () => {
    stubs.rpc.mockClear(); expect(await confirmStatusSubscription({ data: { token: "a".repeat(66) } })).toEqual({ ok: false, error: "Invalid or tampered token" });
    expect(stubs.rpc).not.toHaveBeenCalled();
  });
});
