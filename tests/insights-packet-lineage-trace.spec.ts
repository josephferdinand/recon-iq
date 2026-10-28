import { describe, expect, it, vi } from "vitest";
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => {
 let validate = (d: any) => d; const chain = { middleware: () => chain, validator: (f: any) => { validate = f; return chain; }, handler: (f: any) => async (i: any) => f({ ...i, data: validate(i.data) }) }; return chain;
} }));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: () => ({}) }));
import { traceRecordedLineage } from "../output/insights-helmholtz-20261002/lineage-trace/lineage.functions";
const tenant = "11111111-1111-4111-8111-111111111111";
const edge = (id: string, source: string, target: string) => ({ id, source_kind: "record", source_ref: source, target_kind: "record", target_ref: target, transform: "Recorded join" });
function client(graph: any[], error: any = null) {
 const reads: Record<string, any>[] = []; const from = vi.fn(() => {
  const filters: any = {};reads.push(filters);const q: any = {};
  q.select = () => q; q.eq = (k: string,v: any) => { filters[k] = v; return q; };q.order = () => q;
  q.limit = async (n: number) => ({ data: graph.filter(e => e.target_ref === filters.target_ref).slice(0,n), error });return q;
 });return { supabase: { from }, reads };
}
async function run(c: any, extra = {}) { return (traceRecordedLineage as any)({ data: { tenant_id: tenant, kind: "record", ref: "result", ...extra }, context: c }); }
describe("recursive recorded lineage", () => {
 it("follows upstream hops under tenant RLS and retains original recorded transformations", async () => {
  const c=client([edge("1","prep","result"),edge("2","source","prep")]);const r=await run(c);
  expect(r.edges.map((e: any)=>e.id)).toEqual(["1","2"]);expect(r.scope.visited_nodes).toBe(3);
  expect(c.reads.every(q=>q.tenant_id===tenant)).toBe(true);expect(r.scope.provenance_complete).toBe(false);
 });
 it("terminates cycles without inventing extra relationships", async () => {
  const c=client([edge("1","prep","result"),edge("2","result","prep")]);const r=await run(c);
  expect(c.reads).toHaveLength(2);expect(r.edges).toHaveLength(2);expect(r.scope.traversal_limited).toBe(false);
 });
 it("returns explicit depth boundaries without claiming complete provenance", async () => {
  const c=client([edge("1","prep","result"),edge("2","source","prep")]);const r=await run(c,{max_depth:1});
  expect(r.edges).toHaveLength(1);expect(r.frontier[0].reason).toBe("depth_limit");expect(r.scope.provenance_complete).toBe(false);
 });
 it("refuses failed scoped reads instead of presenting empty provenance", async () => {
  const c=client([],{code:"42501"});await expect(run(c)).rejects.toThrow("Forbidden");
 });
 it("keeps empty recorded coverage unknown", async () => {
  const r=await run(client([]));expect(r.edges).toHaveLength(0);expect(r.scope.provenance_complete).toBe(false);expect(r.scope.coverage).toContain("unknown");
 });
});
