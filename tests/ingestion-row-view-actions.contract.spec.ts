import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("ingestion list row View actions", () => {
  it("opens the matching data source details and keeps writes permission-gated", async () => {
    const ui = await readFile("src/components/data-sources-tab.tsx", "utf8");
    expect(ui).toContain("aria-label={`View ${source.name}`}");
    expect(ui).toContain("setSelectedSourceId(source.id); setViewSourceId(source.id);");
    expect(ui).toContain("Dialog open={Boolean(viewSourceId)}");
    expect(ui).toContain("<FviDetailDialogLayout");
    expect(ui).toContain("title={viewSource.name}");
    expect(ui).toContain('onOpenAutoFocus={(event) => { event.preventDefault(); (event.currentTarget as HTMLElement).querySelector<HTMLElement>("[data-fvi-dialog-title]")?.focus(); }}');
    expect(ui).toContain("detailQ.data.uploads.map");
    expect(ui).toContain("canWrite && isFileSourceType(viewSource.source_type)");
    expect(ui).toContain("mArchive.mutate(viewSource.id)");
    expect(ui).toContain("max-h-[92dvh]");
    expect(ui).toContain("pendingFilePickerRef.current = viewSource.id; setViewSourceId(null);");
    expect(ui).toContain("void confirmDeleteSource(viewSource).finally(() => viewTriggerRef.current?.focus())");
    expect(ui).toContain("pendingFilePickerRef.current = null; viewTransitionRef.current = false; viewTriggerRef.current?.focus();");
  });

  it("opens the matching connection details and preserves its existing history and action paths", async () => {
    const ui = await readFile("src/components/connectors-tab.tsx", "utf8");
    expect(ui).toContain("aria-label={`View ${s.name}`}");
    expect(ui).toContain("setSelectedId(s.id); setViewId(s.id);");
    expect(ui).toContain("Dialog open={Boolean(viewId)}");
    expect(ui).toContain("<FviDetailDialogLayout");
    expect(ui).toContain("title={viewed.name}");
    expect(ui).toContain('onOpenAutoFocus={(event) => { event.preventDefault(); (event.currentTarget as HTMLElement).querySelector<HTMLElement>("[data-fvi-dialog-title]")?.focus(); }}');
    expect(ui).toContain("trigger.mutate(viewed.id)");
    expect(ui).toContain("setRunsOpen(viewed.id)");
    expect(ui).toContain("disabled={!canWrite}");
    expect(ui).toContain("max-h-[92dvh]");
    expect(ui).toContain("setViewId(null); setRunsOpen(viewed.id);");
    expect(ui).toContain("setViewId(null); void startEdit(viewed);");
    expect(ui).toContain("setViewId(null); void confirm({ title: \"Delete schedule?\"");
  });

  it("opens the matching watcher details without replacing row selection", async () => {
    const ui = await readFile("src/components/watchers-tab.tsx", "utf8");
    expect(ui).toContain("aria-label={`View ${w.name}`}");
    expect(ui).toContain("setSelectedId(w.id); setViewId(w.id);");
    expect(ui).toContain("Dialog open={Boolean(viewId)}");
    expect(ui).toContain("<FviDetailDialogLayout");
    expect(ui).toContain("title={viewed.name}");
    expect(ui).toContain('onOpenAutoFocus={(event) => { event.preventDefault(); (event.currentTarget as HTMLElement).querySelector<HTMLElement>("[data-fvi-dialog-title]")?.focus(); }}');
    expect(ui).toContain("ev.mutate(viewed.id)");
    expect(ui).toContain("setDraft({ ...viewed, tenant_id: tenantId })");
    expect(ui).toContain("disabled={!canWrite}");
    expect(ui).toContain("max-h-[92dvh]");
    expect(ui).toContain("setViewId(null); setDraft({ ...viewed, tenant_id: tenantId }); setOpen(true);");
    expect(ui).toContain("setViewId(null); if (await confirm({ title: \"Disable watcher?\"");
  });

  it("opens the matching pipeline configuration with its existing governed actions", async () => {
    const ui = await readFile("src/components/data-prep-tab.tsx", "utf8");
    expect(ui).toContain("aria-label={`View ${p.name}`}");
    expect(ui).toContain("setSelectedPipelineId(p.id); setViewPipelineId(p.id);");
    expect(ui).toContain("Dialog open={Boolean(viewPipelineId)}");
    expect(ui).toContain("<FviDetailDialogLayout");
    expect(ui).toContain("title={viewedPipeline.name}");
    expect(ui).toContain('onOpenAutoFocus={(event) => { event.preventDefault(); (event.currentTarget as HTMLElement).querySelector<HTMLElement>("[data-fvi-dialog-title]")?.focus(); }}');
    expect(ui).toContain("exec.mutate(viewedPipeline.id)");
    expect(ui).toContain("setDraft({ ...viewedPipeline, tenant_id: tenantId })");
    expect(ui).toContain("mApprovePromo.mutate(viewedPipeline.id)");
    expect(ui).toContain("disabled={!canWrite}");
    expect(ui).toContain("max-h-[92dvh]");
    expect(ui).toContain("const confirm = (options: Parameters<typeof requestConfirm>[0]) => {");
    expect(ui).toContain("if (viewPipelineId && (open || diffOpen || promoOpen))");
    expect(ui).toContain("if (viewTransitionRef.current) { viewTransitionRef.current = false; return; }");
  });
});
