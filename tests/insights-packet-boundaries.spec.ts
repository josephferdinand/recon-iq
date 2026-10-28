import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import ts from "typescript";
const packet = "./LOCAL_USER/AppData/Local/Temp/fvi-codex-docs-release-20260930/";
const read = (file: string) => readFileSync(file, "utf8").replace(/\r\n/g, "\n");
const rebased = "output/insights-helmholtz-20261002/rebased/";
describe("actual packet integration boundaries", () => {
 it("preserves the exact existing EOD component suffix and server non-Aging suffix", () => {
  for (const [file, marker] of [["src/components/ageing-eod-tabs.tsx", "export function EodSignoffTab"], ["src/lib/batch-bc.functions.ts", "export const listAgeing"]]) {
   const a=read(packet+file);const b=read(rebased+file);expect(b.slice(b.indexOf(marker))).toBe(a.slice(a.indexOf(marker)));
  }
 });
 it("retains actual tenant Audit routing and excludes absent personal-audit files", () => {
  const page=read(packet+"src/routes/_authenticated/$slug/workspace.tsx");expect(page).toContain('<AuditTab tenantId={tenant.id}');
  const audit=read(rebased+"src/components/audit-tab.tsx");expect(audit).toContain('listRecentAudit');expect(audit).not.toContain('listMyWorkspaceAudit');
 });
 it("preserves the full actual PDF linking handler, source signing and visibility confirmation", () => {
  const file="src/components/productivity-tab.tsx";const a=read(packet+file),b=read(rebased+file);
  const start="  const saveSelectedExceptionLink = async () => {",end="  // Pivot / saved-view state";
  expect(b.slice(b.indexOf(start),b.indexOf(end))).toBe(a.slice(a.indexOf(start),a.indexOf(end)));
  expect(b).toContain('createSignedUrl(path, 900)');expect(b).toContain('visibleSourceConfirmed');expect(b).toContain('readPdfDocumentExceptionLinks');
 });
 it("has no undeclared identifiers in the preserved Agent reversal helper dependencies", () => {
  const s=read("output/insights-helmholtz-20261002/agent-integration/agent.functions.ts");
  expect(s).toContain('async function assertWriter');expect(s).toContain('export async function performAgentActionReversal');
  expect(s).toContain('requireProductionRunStepUp, enforceHourlyActionLimit, TOOL_TO_ACTION_KIND');
  const parsed=ts.createSourceFile("agent.ts",s,ts.ScriptTarget.Latest,true);expect((parsed as any).parseDiagnostics).toHaveLength(0);
 });
});
