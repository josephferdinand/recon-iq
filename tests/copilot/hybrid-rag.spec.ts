import { describe, it, expect, vi } from "vitest";
import { hybridSearchKb } from "@/lib/copilot-tools.server";

vi.mock("@/lib/kb-embeddings.server", () => ({
  embedQuery: vi.fn(async () => [0.1, 0.2, 0.3]),
}));

function mockSupaWithRpc(opts: { semantic?: any[]; lexical?: any[] }) {
  return {
    rpc(name: string) {
      if (name === "match_kb_chunks") {
        return Promise.resolve({ data: opts.semantic ?? [], error: null });
      }
      if (name === "match_kb_chunks_lexical") {
        return Promise.resolve({ data: opts.lexical ?? [], error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    from() {
      const builder: any = {};
      for (const m of ["select","eq","is","in","gte","lte","lt","or","ilike","order","limit"]) builder[m] = () => builder;
      builder.then = (r: any) => Promise.resolve({ data: [], error: null }).then(r);
      builder.maybeSingle = () => Promise.resolve({ data: null, error: null });
      return builder;
    },
  } as any;
}

describe("hybridSearchKb", () => {
  it("returns hybrid-fused results from semantic + lexical candidates", async () => {
    const supa = mockSupaWithRpc({
      semantic: [
        { chunk_id: "c1", article_id: "a1", title: "Onboarding", slug: "onboard", scope: "platform", content: "Welcome…", tenant_id: null },
        { chunk_id: "c2", article_id: "a2", title: "FX rules", slug: "fx", scope: "platform", content: "FX…", tenant_id: null },
      ],
      lexical: [
        { chunk_id: "c2", article_id: "a2", title: "FX rules", slug: "fx", scope: "platform", content: "FX…", tenant_id: null },
        { chunk_id: "c3", article_id: "a3", title: "Breaks 101", slug: "breaks", scope: "platform", content: "Breaks…", tenant_id: null },
      ],
    });
    const ctx = { supabase: supa, userId: "u1", scope: "tenant" as const, tenantId: null, isPlatformAdmin: false };
    const out = await hybridSearchKb(ctx, { query: "fx", k: 5 });
    expect(out.mode).toBe("hybrid");
    // c2 appears in both lists → fused score is the sum → ranks first.
    expect(out.results[0].article_id).toBe("a2");
    expect(out.results.length).toBeGreaterThanOrEqual(3);
  });

  it("applies the 1.2× per-tenant freshness boost to tenant-owned chunks", async () => {
    const tenantId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const supa = mockSupaWithRpc({
      semantic: [
        { chunk_id: "c1", article_id: "a1", title: "Platform doc", slug: "p", scope: "platform", content: "x", tenant_id: null },
      ],
      lexical: [
        // Tenant-owned chunk arrives in second-rank slot but should overtake
        // the platform chunk after the freshness boost (1.2x > 1).
        { chunk_id: "c1", article_id: "a1", title: "Platform doc", slug: "p", scope: "platform", content: "x", tenant_id: null },
        { chunk_id: "c2", article_id: "a2", title: "Tenant doc", slug: "t", scope: "tenant", content: "y", tenant_id: tenantId },
      ],
    });
    const ctx = { supabase: supa, userId: "u1", scope: "tenant" as const, tenantId, isPlatformAdmin: false };
    const out = await hybridSearchKb(ctx, { query: "doc", k: 5 });
    const tenantRow = out.results.find((r) => r.article_id === "a2")!;
    const platformRow = out.results.find((r) => r.article_id === "a1")!;
    // Boost applied: tenant row's score reflects 1.2x multiplier.
    expect(tenantRow.score).toBeGreaterThan(0);
    expect(tenantRow.score).toBeCloseTo((1 / (60 + 2)) * 1.2, 6);
    expect(platformRow.score).toBeCloseTo(1 / (60 + 1) + 1 / (60 + 1), 6);
  });
});
