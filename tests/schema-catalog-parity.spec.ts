import { describe, expect, it } from "vitest";

import {
  applyRemoteOnlyAllowlist,
  compareCatalogs,
  normalizeCatalogRows,
} from "../scripts/compare-supabase-schema-catalog.mjs";

const row = (kind: string, key: string, digest: string) => ({ kind, key, digest });
const A = "a".repeat(32);
const B = "b".repeat(32);

describe("read-only Supabase schema catalog parity", () => {
  it("normalizes and sorts safe catalog rows", () => {
    expect(normalizeCatalogRows([row("table", "public.z", A), row("column", "public.a.id", B)]))
      .toEqual([row("column", "public.a.id", B), row("table", "public.z", A)]);
  });

  it("rejects malformed and duplicate catalog identities", () => {
    expect(() => normalizeCatalogRows([row("table", "", A)])).toThrow("invalid row");
    expect(() => normalizeCatalogRows([row("table", "public.a", A), row("table", "public.a", B)]))
      .toThrow("duplicate identities");
  });

  it("reports exact, missing, extra, and changed objects independently", () => {
    const result = compareCatalogs(
      [row("relation", "public.a", A), row("column", "public.a.id", A), row("index", "public.a_idx", A)],
      [row("relation", "public.a", A), row("column", "public.a.id", B), row("policy", "public.a.read", A)],
    );
    expect(result.exact).toBe(false);
    expect(result.missingRemote.map(({ key }) => key)).toEqual(["public.a_idx"]);
    expect(result.remoteOnly.map(({ key }) => key)).toEqual(["public.a.read"]);
    expect(result.changed.map(({ key }) => key)).toEqual(["public.a.id"]);
  });

  it("allows only exact, reasoned platform-managed remote objects", () => {
    const comparison = compareCatalogs(
      [row("relation", "public.a", A)],
      [row("relation", "public.a", A), row("function", "public.managed()", B)],
    );
    const result = applyRemoteOnlyAllowlist(comparison, [
      { kind: "function", key: "public.managed()", reason: "platform managed" },
    ]);
    expect(result.exactApplicationSchema).toBe(true);
    expect(result.allowedRemoteOnly).toHaveLength(1);
    expect(result.unexpectedRemoteOnly).toEqual([]);
  });
});
