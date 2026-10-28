import { describe, it, expect, vi } from "vitest";
import { runRegisteredStatusProbe, type RegisteredStatusProbe } from "@/lib/status-probe-runner.server";
const definition: RegisteredStatusProbe = { cell_key: "fixture-prod", function_key: "fixture.read", registered: true, enabled: true, kind: "functional",
  origin: "https://fixture.invalid", path: "/api/read", allowedOrigins: ["https://fixture.invalid"], timeout_ms: 1000 };
const deps = (response: Response) => ({ fetch: vi.fn().mockResolvedValue(response), authorize: vi.fn().mockResolvedValue({ Authorization: "Bearer synthetic-fixture-only" }), record: vi.fn().mockResolvedValue(undefined) });
describe("registered status probe runner", () => {
  it("does not equate an HTTP 200 with a functional pass", async () => {
    expect((await runRegisteredStatusProbe(definition, deps(Response.json({ ok: true })))).outcome).toBe("unknown");
  });
  it("records an actual semantic outage and recovery fixture, without diagnostics or credentials", async () => {
    const failed = deps(new Response("synthetic raw diagnostics", { status: 503 }));
    expect((await runRegisteredStatusProbe(definition, failed)).outcome).toBe("outage");
    const recovered = deps(Response.json({ readable: true }));
    expect((await runRegisteredStatusProbe({ ...definition, assert: (body: any) => body.readable === true ? "healthy" : "unknown" }, recovered)).outcome).toBe("healthy");
    expect(JSON.stringify(failed.record.mock.calls)).not.toMatch(/diagnostics|Authorization|Bearer|fixture\.invalid/);
  });
  it("treats role/endpoint/rate-limit responses as unknown coverage", async () => {
    for (const status of [401, 403, 404, 429]) expect((await runRegisteredStatusProbe(definition, deps(new Response(null, { status })))).outcome).toBe("unknown");
  });
  it("does not run unregistered probes or fetch outside the approved origin/API path", async () => {
    const mock = deps(Response.json({}));
    expect(await runRegisteredStatusProbe({ ...definition, registered: false }, mock)).toEqual({ attempted: false, outcome: "unknown" });
    expect(mock.fetch).not.toHaveBeenCalled();
    await expect(runRegisteredStatusProbe({ ...definition, origin: "https://unregistered.invalid" }, mock)).rejects.toThrow("registered");
    await expect(runRegisteredStatusProbe({ ...definition, path: "/api/../admin" }, mock)).rejects.toThrow("path changed");
  });
});
