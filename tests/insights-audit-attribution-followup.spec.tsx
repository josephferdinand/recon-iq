// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ query: {} as any }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => state.query }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: any) => fn }));
vi.mock("@/lib/tenants.functions", () => ({ listRecentAudit: vi.fn() }));
import { AuditTab, auditActorLabel, auditRowsToCsv } from "../output/insights-helmholtz-20261002/audit-attribution-followup/audit-tab";
afterEach(cleanup);
const row = { id: 1, occurred_at: new Date().toISOString(), actor_email: null, actor_user_id: "11111111-1111-4111-8111-111111111111", scope: "tenant", action: "group.member.add", resource_type: "tenant_group_members", resource_id: "synthetic-resource", context: {} };
describe("separate Audit attribution follow-up source", () => {
 it("shows recorded identity when the denormalized email is absent", () => {
  state.query = { data: [row], isSuccess:true, isFetching:false, isError:false, refetch:vi.fn() };
  render(<AuditTab tenantId="synthetic-tenant" />);
  expect(screen.getByText(`User ${row.actor_user_id}`)).toBeTruthy();expect(screen.queryByText("Actor identity unavailable")).toBeNull();
 });
 it("counts stable actor IDs rather than treating missing email as zero recorded actors", () => {
  state.query = { data: [row,{...row,id:2,actor_email:"synthetic@example.invalid"}], isSuccess:true,isFetching:false,isError:false,refetch:vi.fn() };
  render(<AuditTab tenantId="synthetic-tenant" />);
  const label=screen.getByText("Recorded actors in loaded events");expect(label.parentElement?.textContent).toContain("1");
 });
 it("retains actor identity in the CSV and does not infer a SYSTEM actor", () => {
  const csv=auditRowsToCsv([row]);expect(csv).toContain("actor_user_id");expect(csv).toContain(row.actor_user_id);expect(csv).not.toContain('"system"');
  expect(auditActorLabel({...row,actor_user_id:null})).toBe("Actor identity unavailable");
 });
});
