import { describe,it,expect } from "vitest";
import { statusDomains,statusCellEvidence,evidenceLabel } from "@/lib/status-display";
import { statusPrototypeSnapshot } from "@/lib/status-prototype-data";
describe("FVI status service comparison evidence",()=>{
 it("retains every current registry row exactly once and makes FVI domains explicit",()=>{
  const snapshot=statusPrototypeSnapshot();const groups=statusDomains(snapshot.health);
  expect(groups.map(g=>g.label)).toEqual(expect.arrayContaining(["Reconciliation","Ingestion & connectors","Data Prep","Copilot","Schedules & recovery","Reporting & collateral","Authentication"]));
  expect(groups.flatMap(g=>g.rows)).toHaveLength(snapshot.health.length);
  expect(new Set(groups.flatMap(g=>g.rows).map(r=>r.cell_key+":"+r.function_key)).size).toBe(snapshot.health.length);
 });
 it("does not infer functional health from deployment or reachable endpoints",()=>{
  const snapshot=statusPrototypeSnapshot();const row={...snapshot.health[0],availability:"deployed" as const,probe_kind:"availability" as const,outcome:"healthy" as const,checked_at:new Date().toISOString(),expected_interval_seconds:60};
  expect(statusCellEvidence([row],snapshot.cells[0],true).state).toBe("unknown");expect(evidenceLabel(row)).toBe("Reachability only");
 });
 it("keeps disabled/source-only scopes distinct and stale coverage explicit",()=>{
  const snapshot=statusPrototypeSnapshot();const base=snapshot.health[0];
  expect(statusCellEvidence([{...base,availability:"disabled"}],snapshot.cells[0],true).state).toBe("not_available");
  const row={...base,availability:"deployed" as const,probe_kind:"functional" as const,outcome:"healthy" as const,checked_at:new Date(Date.now()-600000).toISOString(),expected_interval_seconds:60};
  expect(statusCellEvidence([row],snapshot.cells[0],true).state).toBe("stale");expect(evidenceLabel(row)).toBe("Stale observation");
 });
});
