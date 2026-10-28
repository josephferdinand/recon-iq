import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("AIDP and reference table list contracts", () => {
  it("keeps both detail popups on the approved responsive split layout and safe focus return", async () => {
    const aidp = await readFile("src/components/aidp-tab.tsx", "utf8");
    const reference = await readFile("src/components/reference-data-tab.tsx", "utf8");
    const aidpDialog = aidp.slice(aidp.indexOf('<Dialog open={!!viewIdentity}'), aidp.indexOf("</Dialog>", aidp.indexOf('<Dialog open={!!viewIdentity}')));
    const referenceDialog = reference.slice(reference.indexOf('<Dialog open={!!viewId}'), reference.indexOf("</Dialog>", reference.indexOf('<Dialog open={!!viewId}')));
    const sharedWindowClass = 'className="h-[min(92dvh,64rem)] max-h-[92dvh] w-[calc(100vw-1rem)] max-w-[min(96vw,88rem)] overflow-hidden gap-0 p-0"';

    for (const dialog of [aidpDialog, referenceDialog]) {
      expect(dialog).toContain(sharedWindowClass);
      expect(dialog).toContain("<FviDetailDialogLayout");
      expect(dialog).toContain('onOpenAutoFocus={(event) => { event.preventDefault();');
      expect(dialog).toContain("viewTriggerRef.current?.isConnected");
      expect(dialog).toContain('data-fvi-dialog-title');
    }
    expect(aidpDialog).toContain("newTemplateButtonRef.current?.focus()");
    expect(referenceDialog).toContain("createTableButtonRef.current?.focus()");
  });

  it("refreshes page-scoped actor summaries after AIDP and reference mutations", async () => {
    const aidp = await readFile("src/components/aidp-tab.tsx", "utf8");
    const reference = await readFile("src/components/reference-data-tab.tsx", "utf8");
    const mutationBlock = (source: string, name: string) => {
      const start = source.indexOf(`const ${name} = useMutation({`);
      const end = source.indexOf("\n  });", start);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeGreaterThan(start);
      return source.slice(start, end);
    };

    for (const name of ["mTpl", "mDel", "mUpload", "mApprove"]) {
      expect(mutationBlock(aidp, name)).toContain("refreshActorSummaries()");
    }
    expect(aidp).toContain('const refreshActorSummaries = () => qc.invalidateQueries({ queryKey: ["resource-actor-summary", tenantId] });');
    for (const name of ["mUpsert", "mLoad"]) {
      expect(mutationBlock(reference, name)).toContain("refreshActorSummaries()");
    }
    expect(reference.slice(reference.indexOf("const refreshGovernance = () => {"), reference.indexOf("const mSubmit = useMutation({"))).toContain("refreshActorSummaries()");
    for (const name of ["mSubmit", "mDecide", "mRollback"]) {
      expect(mutationBlock(reference, name)).toContain("refreshGovernance()");
    }
  });

  it("keeps View available in each horizontal list and marks the inspected row", async () => {
    const aidp = await readFile("src/components/aidp-tab.tsx", "utf8");
    const reference = await readFile("src/components/reference-data-tab.tsx", "utf8");

    expect(aidp.match(/fvi-sticky-view-cell/g)?.length).toBeGreaterThanOrEqual(4);
    expect(aidp).toContain('className={`border-b last:border-0 ${isSelected ? "fvi-selected-row" : ""}`}');
    expect(aidp).toContain('className={`border-b ${isSelected ? "fvi-selected-row" : ""}`}');
    expect(aidp.match(/className="fvi-row-view-action"/g)?.length).toBe(2);
    expect(aidp).toContain('Dialog open={!!viewIdentity}');

    expect(reference).toContain('className="fvi-sticky-view-cell px-6 py-4 text-right"');
    expect(reference).toContain('className="fvi-sticky-view-cell px-6 py-3 text-right"');
    expect(reference).toContain('className="fvi-row-view-action"');
    expect(reference).toContain('isSel ? "fvi-selected-row" : ""');
    expect(reference).toContain('Dialog open={!!viewId}');
  });

  it("uses page-scoped actor summaries without unsupported identity filters", async () => {
    const aidp = await readFile("src/components/aidp-tab.tsx", "utf8");
    const reference = await readFile("src/components/reference-data-tab.tsx", "utf8");
    const aidpServer = await readFile("src/lib/aidp.functions.ts", "utf8");
    const referenceServer = await readFile("src/lib/reference-data.functions.ts", "utf8");

    expect(aidp).toContain("Search by filename");
    expect(aidp).toContain("Search templates");
    expect(reference).toContain("Search reference tables");
    expect(aidp).toContain('resource_type: "aidp_document"');
    expect(aidp).toContain('resource_type: "aidp_template"');
    expect(aidp).toContain('resource_ids: documents.map((row: any) => row.id).slice(0, 100)');
    expect(aidp).toContain('resource_ids: templates.map((row: any) => row.id).slice(0, 100)');
    expect(aidp).toContain('<ResourceActorSummary mode="detail"');
    expect(aidpServer).toContain('select("id, tenant_id, name, doc_kind, schema, sample_prompt, created_at"');
    expect(aidpServer).toContain('select("id, original_filename, mime, bytes, status, confidence, model, cost_usd, created_at, template_id"');
    expect(aidp).not.toContain('mode="updated-line"');
    expect(reference).toContain('resource_type: "reference_table"');
    expect(reference).toContain('resource_ids: tables.map((row: any) => row.id).slice(0, 100)');
    expect(reference).toContain('ResourceActorSummary mode="updated-line"');
    expect(reference).toContain('ResourceActorSummary mode="detail"');
    expect(reference).toContain("formatWhen(t.updated_at ?? t.created_at)");
    expect(aidpServer).toContain('.ilike("original_filename"');
    expect(aidpServer).toContain('.ilike("name"');
    expect(referenceServer).toContain("name.ilike");
    expect(referenceServer).toContain("description.ilike");
    expect(aidp).not.toMatch(/Search[^\n]*(?:Public ID|business unit|user group|actor|updated date)/i);
    expect(reference).not.toMatch(/Search[^\n]*(?:Public ID|business unit|user group|actor|updated date)/i);
    expect(aidp).not.toMatch(/created_by|updated_by|\.email/);
    expect(reference).not.toMatch(/created_by|updated_by|\.email/);
  });
});
