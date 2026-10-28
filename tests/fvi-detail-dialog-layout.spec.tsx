import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("FVI split detail dialog", () => {
  it("provides a theme-token-based responsive rail, main content, and shared actions footer", async () => {
    const layout = await readFile("src/components/fvi-detail-dialog-layout.tsx", "utf8");
    expect(layout).toContain("sm:grid-cols-[minmax(17rem,27%)_minmax(0,1fr)]");
    expect(layout).toContain("bg-[var(--ink-2)]");
    expect(layout).toContain("bg-[var(--fvi-gold)]");
    expect(layout).toContain("overflow-y-auto");
    expect(layout).toContain("{actions}");
  });

  it("uses real pipeline metadata and preserves action gating and focus restoration", async () => {
    const source = await readFile("src/components/data-prep-tab.tsx", "utf8");
    const dialog = source.slice(source.indexOf("<Dialog open={Boolean(viewPipelineId)}"), source.indexOf("</Dialog>", source.indexOf("<Dialog open={Boolean(viewPipelineId)}")));
    expect(dialog).toContain("<FviDetailDialogLayout");
    expect(dialog).toContain("viewedPipeline.last_run_at");
    expect(dialog).toContain("viewedPipeline.public_uid");
    expect(dialog).toContain("disabled={!canWrite || exec.isPending");
    expect(dialog).toContain("disabled={!canWrite || mApprove.isPending");
    expect(dialog).toContain("viewTriggerRef.current?.focus()");
    expect(dialog).not.toContain("As of");
    expect(dialog).not.toContain("new Date()");
  });

  it("uses recorded AIDP metadata and preserves document and template actions", async () => {
    const source = await readFile("src/components/aidp-tab.tsx", "utf8");
    const dialog = source.slice(source.indexOf("<Dialog open={!!viewIdentity}"), source.indexOf("</Dialog>", source.indexOf("<Dialog open={!!viewIdentity}")));
    expect(dialog).toContain("<FviDetailDialogLayout");
    expect(dialog).toContain("viewedDoc.status");
    expect(dialog).toContain("viewedDoc.created_at");
    expect(dialog).toContain("viewedDoc.confidence");
    expect(dialog).toContain("viewedDoc.cost_usd");
    expect(dialog).toContain("disabled={mApprove.isPending}");
    expect(dialog).toContain("canWrite && viewedDoc.status === \"review\"");
    expect(dialog).toContain("disabled={mDel.isPending}");
    expect(dialog).toContain("onOpenAutoFocus");
    expect(dialog).toContain("viewTriggerRef.current?.isConnected");
    expect(dialog).toContain("newTemplateButtonRef.current?.focus()");
    expect(source).toContain('if (viewIdentity?.kind === "template" && viewIdentity.id === id) setViewIdentity(null);');
    expect(dialog).not.toContain("As of");
    expect(dialog).not.toContain("mapping");
  });

  it("uses saved reference-table metadata, scoped assignments, and keyboard focus handling", async () => {
    const source = await readFile("src/components/reference-data-tab.tsx", "utf8");
    const dialog = source.slice(source.indexOf("<Dialog open={!!viewId}"), source.indexOf("</Dialog>", source.indexOf("<Dialog open={!!viewId}")));
    expect(dialog).toContain("<FviDetailDialogLayout");
    expect(dialog).toContain("viewedTable.is_active");
    expect(dialog).toContain("viewedTable.created_at");
    expect(dialog).toContain("viewedTable.updated_at");
    expect(dialog).toContain("viewedTable.row_count");
    expect(dialog).toContain("ResourceIdentitySummary mode=\"detail\"");
    expect(dialog).toContain("data-fvi-dialog-title");
    expect(dialog).toContain("viewTriggerRef.current?.isConnected");
    expect(dialog).toContain("createTableButtonRef.current?.focus()");
    expect(dialog).not.toContain("As of");
    expect(dialog).not.toContain("mapping");
    expect(dialog).not.toContain("new Date()");
  });
});
