import { describe, expect, it } from "vitest";
import { loadPublicStatusSnapshot } from "@/lib/status.functions";
import { statusPrototypeSnapshot } from "@/lib/status-prototype-data";
function client(catalogError = false, measuredError = false, malformed = false) {
  const proto = statusPrototypeSnapshot();
  const chain: any = { select: () => chain, order: () => chain, abortSignal: () => chain,
    then: (resolve: any, reject: any) => Promise.resolve({ data: catalogError ? null : proto.components, error: catalogError }).then(resolve,reject) };
  return { from: () => chain, rpc: () => ({ abortSignal: () => Promise.resolve({ data: malformed ? {} : proto, error: measuredError }) }) } as any;
}
describe("regional public snapshot", () => {
  it("keeps the eight declared components from becoming functional proof", async () => {
    const result = await loadPublicStatusSnapshot(client());
    expect(result.components).toHaveLength(8); expect(result.overall).toBe("unknown");
    expect(result.components.every((row) => row.state_evidence === "catalog_declaration_only")).toBe(true);
    expect(result.legacy_history_used).toBe(false); expect(result.history).toEqual([]);
  });
  it("fails closed on missing/malformed measured evidence", async () => {
    for (const source of [client(false,true),client(false,false,true)]) {
      const result = await loadPublicStatusSnapshot(source); expect(result.data_status).toBe("partial"); expect(result.overall).toBe("unknown"); expect(result.cells).toEqual([]);
    }
    expect((await loadPublicStatusSnapshot(client(true,true))).data_status).toBe("unavailable");
  });
});
