import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceFile = (path: string) => readFile(fileURLToPath(new URL(path, import.meta.url)), "utf8");

describe("Data Prep central screen contract", () => {
  it("keeps pipeline search, filters, stable ordering and output pagination tenant-scoped", async () => {
    const source = await sourceFile("../src/lib/data-prep.functions.ts");
    const listing = source.match(/export const listPipelines[\s\S]*?\/\/ Approved pipelines/u)?.[0] ?? "";
    expect(listing).toContain(".middleware([requireSupabaseAuth()])");
    expect(listing).toContain('.eq("tenant_id", data.tenant_id)');
    expect(listing).toContain('.order("updated_at", { ascending: false }).order("id", { ascending: true })');
    expect(listing).toContain("data.page_size");
    expect(listing).toContain("row.steps");
    expect(listing).toContain("row.dq_rules");
    expect(listing).toContain("last_run");
    expect(listing).toContain("matches.slice(start, start + data.page_size)");
    expect(listing).toContain("return { rows:");
  });

  it("separates configured DQ rule counts from run outcomes and blocks empty drafts", async () => {
    const source = await sourceFile("../src/components/data-prep-tab.tsx");
    expect(source).toContain("A configured DQ rule is not a passing run result");
    expect(source).toContain("DQ results");
    expect(source).toContain('!(viewedPipeline.steps ?? []).length');
    expect(source).toContain("not runnable or approvable yet");
    expect(source).toContain("independent checking is not established by this screen");
  });

  it("retains four-eyes staging promotion actions and the existing approval endpoint", async () => {
    const source = await sourceFile("../src/components/data-prep-tab.tsx");
    expect(source).toContain("Request promotion</Button>");
    expect(source).toContain("Approve promotion</Button>");
    expect(source).toContain("mReqPromo.mutate");
    expect(source).toContain("mApprovePromo.mutate");
    expect(source).toContain("mApprove.mutate");
  });

  it("renders retry, empty and rich View details without fabricated success", async () => {
    const source = await sourceFile("../src/components/data-prep-tab.tsx");
    expect(source).toContain("Pipelines could not be loaded");
    expect(source).toContain("No pipelines match these filters");
    expect(source).toContain("No runs yet. Run an approved pipeline to see its status");
    expect(source).not.toContain("Example: Falcon Nostro USD vs GL");
    expect(source).toContain("Configured sources");
    expect(source).toContain("Last run DQ results");
    expect(source).toContain("Configured DQ rules");
  });

  it("routes module failures through contextual messages and preserves uncertain-write recovery", async () => {
    const source = await sourceFile("../src/components/data-prep-tab.tsx");
    expect(source).toContain('import { formatUserMessage, mapKnownFailure');
    expect(source).toContain("dataPrepWriteFailure");
    expect(source).toContain('"unknown_write_outcome"');
    expect(source).toContain('"check-run-history"');
    expect(source).toContain('"retry-comparison"');
    expect(source).not.toMatch(/toast\.error\(e\.message\)/u);
  });

  it("keeps pipeline rows compact and centralizes governed actions in the rich View dialog", async () => {
    const source = await sourceFile("../src/components/data-prep-tab.tsx");
    const table = source.match(/<table className="w-full min-w-\[1240px\] text-sm">([\s\S]*?)<\/table>/u)?.[1] ?? "";
    expect(table).not.toContain("exec.mutate");
    expect(table).not.toContain("mApprove.mutate");
    expect(table).not.toContain("mApprovePromo.mutate");
    expect(table).not.toContain("Archive pipeline");
    expect(table).not.toContain(">Edit<");
    expect(source).toContain("exec.mutate(viewedPipeline.id)");
    expect(source).toContain("mApprove.mutate(viewedPipeline.id)");
    expect(source).toContain("mApprovePromo.mutate(viewedPipeline.id)");
    expect(source).toContain("remove.mutate(viewedPipeline.id)");
    expect(source).toContain("setDraft({ ...viewedPipeline");
    expect(source).toContain("actions={<>");
    expect(source).not.toContain("grid gap-5 lg:grid-cols-[1fr_1.3fr]");
  });
});
