import { afterEach, describe, expect, it, vi } from "vitest";

const { state, supabaseAdmin } = vi.hoisted(() => {
  const state = {
    schedule: null as Record<string, unknown> | null,
    definition: null as Record<string, unknown> | null,
    allowed: false,
    rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  };
  const supabaseAdmin = {
    from: vi.fn((table: string) => {
      const filters: Record<string, unknown> = {};
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return builder;
        },
        maybeSingle: async () => {
          const row = table === "recon_schedules" ? state.schedule : state.definition;
          if (!row || Object.entries(filters).some(([key, value]) => row[key] !== value)) {
            return { data: null, error: null };
          }
          return { data: row, error: null };
        },
      };
      return builder;
    }),
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ name, args });
      if (name === "service_recon_actor_access_decision") return { data: state.allowed, error: null };
      return { data: [{ disposition: "disabled", schedule_run_id: null }], error: null };
    }),
  };
  return { state, supabaseAdmin };
});

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin }));

const tenantA = "11111111-1111-4111-8111-111111111111";
const tenantB = "22222222-2222-4222-8222-222222222222";
const actorA = "33333333-3333-4333-8333-333333333333";
const scheduleId = "44444444-4444-4444-8444-444444444444";
const definitionId = "55555555-5555-4555-8555-555555555555";

afterEach(() => {
  vi.clearAllMocks();
  state.schedule = null;
  state.definition = null;
  state.allowed = false;
  state.rpcCalls = [];
});

describe("scheduled reconciliation authorization", () => {
  it("rejects a tenant A actor targeting a tenant B schedule before any claim", async () => {
    state.schedule = {
      id: scheduleId,
      tenant_id: tenantB,
      definition_id: definitionId,
      created_by: actorA,
    };

    const { executeReconSchedule } = await import("@/lib/recon-orchestrator.server");
    await expect(executeReconSchedule(scheduleId, tenantA, "manual", actorA)).rejects.toThrow("Schedule not found");

    expect(state.rpcCalls).toEqual([]);
    expect(supabaseAdmin.from).toHaveBeenCalledWith("recon_schedules");
  });

  it("rejects an actor without definition run authority before claiming or writing", async () => {
    state.schedule = {
      id: scheduleId,
      tenant_id: tenantA,
      definition_id: definitionId,
      created_by: actorA,
    };
    state.definition = { id: definitionId, tenant_id: tenantA };
    state.allowed = false;

    const { executeReconSchedule } = await import("@/lib/recon-orchestrator.server");
    await expect(executeReconSchedule(scheduleId, tenantA, "manual", actorA)).rejects.toThrow("not authorized");

    expect(state.rpcCalls).toEqual([{
      name: "service_recon_actor_access_decision",
      args: { _actor_user_id: actorA, _recon_id: definitionId, _action: "run" },
    }]);
  });

  it("fails closed when a scheduled run has no accountable actor", async () => {
    state.schedule = {
      id: scheduleId,
      tenant_id: tenantA,
      definition_id: definitionId,
      created_by: null,
    };

    const { executeReconSchedule } = await import("@/lib/recon-orchestrator.server");
    await expect(executeReconSchedule(scheduleId, tenantA, "cron")).rejects.toThrow("accountable");
    expect(state.rpcCalls).toEqual([]);
  });

  it("binds an authorized schedule claim to its tenant and accountable actor", async () => {
    state.schedule = {
      id: scheduleId,
      tenant_id: tenantA,
      definition_id: definitionId,
      created_by: actorA,
    };
    state.definition = { id: definitionId, tenant_id: tenantA };
    state.allowed = true;

    const { executeReconSchedule } = await import("@/lib/recon-orchestrator.server");
    const result = await executeReconSchedule(scheduleId, tenantA, "cron");

    expect(result.disposition).toBe("disabled");
    expect(state.rpcCalls.map(({ name }) => name)).toEqual([
      "service_recon_actor_access_decision",
      "claim_recon_schedule_run_for_definition",
    ]);
    expect(state.rpcCalls[0]?.args).toEqual({
      _actor_user_id: actorA,
      _recon_id: definitionId,
      _action: "run",
    });
    expect(state.rpcCalls[1]?.args).toMatchObject({
      _tenant_id: tenantA,
      _definition_id: definitionId,
      _schedule_id: scheduleId,
      _actor_user_id: actorA,
    });
  });
});
