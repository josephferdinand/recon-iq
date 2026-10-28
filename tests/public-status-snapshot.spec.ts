import { describe, expect, it } from "vitest";
import { loadPublicStatusSnapshot } from "@/lib/status.functions";

const component = {
  id: "component-1",
  key: "api",
  name: "API",
  description: null,
  state: "operational",
  group_name: "Platform",
  display_order: 1,
  updated_at: "2026-09-23T00:00:00.000Z",
};

function mockSupabase(overrides: Record<string, any> = {}) {
  const defaults: Record<string, any> = {
    status_components: { data: [component], error: null },
    status_component_history: { data: [], error: null },
    status_incidents: { data: [], error: null },
    status_overall: { data: "operational", error: null },
  };
  const results = { ...defaults, ...overrides };
  const query = (result: { data: unknown; error: unknown; throw?: unknown }) => {
    const chain: any = {
      select: () => chain,
      order: () => chain,
      gte: () => chain,
      limit: () => chain,
      abortSignal: () => chain,
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        (result.throw ? Promise.reject(result.throw) : Promise.resolve(result)).then(resolve, reject),
    };
    return chain;
  };
  return {
    from: (table: string) => query(results[table]),
    rpc: (name: string) => query(results[name]),
  } as any;
}

describe("public status snapshot truthfulness", () => {
  it("marks a snapshot complete when all sources return data and preserves operational status", async () => {
    const snapshot = await loadPublicStatusSnapshot(mockSupabase());

    expect(snapshot.data_status).toBe("complete");
    expect(snapshot.overall).toBe("operational");
    expect(snapshot.components).toEqual([component]);
    expect(snapshot.history).toEqual([]);
    expect(snapshot.incidents).toEqual([]);
  });

  it("marks null source data partial and prevents a misleading operational green", async () => {
    const snapshot = await loadPublicStatusSnapshot(mockSupabase({
      status_components: { data: null, error: null },
    }));

    expect(snapshot.data_status).toBe("partial");
    expect(snapshot.overall).toBe("degraded_performance");
    expect(snapshot.components).toEqual([]);
  });

  it("reports unavailable when every source fails, including an aborted query", async () => {
    const timeout = Object.assign(new Error("aborted"), { name: "AbortError" });
    const failed = { data: null, error: { message: "source unavailable" } };
    const supabase = mockSupabase({
      status_components: { data: null, error: null, throw: timeout },
      status_component_history: failed,
      status_incidents: failed,
      status_overall: failed,
    });
    const snapshot = await loadPublicStatusSnapshot(supabase);

    expect(snapshot.data_status).toBe("unavailable");
    expect(snapshot.overall).toBe("degraded_performance");
    expect(snapshot.components).toEqual([]);
    expect(snapshot.history).toEqual([]);
    expect(snapshot.incidents).toEqual([]);
  });

  it("keeps a reported outage visible when another source fails", async () => {
    const snapshot = await loadPublicStatusSnapshot(mockSupabase({
      status_component_history: { data: null, error: new Error("query timeout") },
      status_overall: { data: "major_outage", error: null },
    }));

    expect(snapshot.data_status).toBe("partial");
    expect(snapshot.overall).toBe("major_outage");
  });
});
