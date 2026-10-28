/**
 * AIDP Slice 3 — predictDocument unit tests.
 * Tests the pure helpers in aidp-predict.server.ts plus the decision logic
 * branches (the network/AI call is mocked).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFile } from "node:fs/promises";

vi.mock("ai", () => ({
  NoObjectGeneratedError: {
    isInstance: (error: unknown) =>
      (error as { name?: string } | null)?.name === "AI_NoObjectGeneratedError",
  },
  generateObject: vi.fn(async () => ({
    object: {
      invoice_no:  { value: "INV-001", confidence: 0.99 },
      total:       { value: "1,234.50", confidence: 0.92 },
      due_date:    { value: "2025-12-31", confidence: 0.40 },
    },
    usage: { promptTokens: 1200, completionTokens: 320 },
  })),
}));

vi.mock("@/lib/ai/muse-provider.server", () => ({
  createMuseCompatible: () => (() => ({ /* fake model */ })),
}));

vi.mock("@/lib/ai/muse-provider.server", () => ({
  createAnthropic: () => (() => ({ /* fake model */ })),
}));

vi.mock("@/lib/ai-gateway.server", () => ({
  createMetaAiGatewayProvider: () => (() => ({ /* fake model */ })),
}));

vi.mock("@/lib/vault-resolver.server", () => ({
  resolveVaultSecret: vi.fn(async () => ({ plaintext: "vault-key", source: "vault" })),
}));

vi.mock("@/lib/ssrf-guard.server", () => ({
  assertSafeOutboundUrl: vi.fn(async () => new URL("https://proxy.example/v1/messages")),
}));

vi.mock("@/lib/aidp-document-service.server", () => ({
  extractPdfTextWithService: vi.fn(async () => ({
    pageCount: 2,
    text: "[Page 1]\nFVI-VALIDATION-001\n\n[Page 2]\nTransaction count 4 · 132,425.00",
  })),
}));

import {
  buildPredictionSchema, coerceValueColumns, decideForField,
  callPredictionModel, discardInvalidOptionalBboxes, estimateAidpInputTokens,
  parseStructuredPredictionText,
  resolveModelVersion, type EntityType,
} from "../../src/lib/aidp-predict.server";

const ETS: EntityType[] = [
  { id: "et1", key: "invoice_no", label: "Invoice #", datatype: "string",
    extractor: "llm", required: true, confidence_threshold: 0.85,
    review_policy: "auto_accept", options: {} },
  { id: "et2", key: "total", label: "Total", datatype: "currency",
    extractor: "llm", required: true, confidence_threshold: 0.85,
    review_policy: "review_below", options: {} },
  { id: "et3", key: "due_date", label: "Due", datatype: "date",
    extractor: "llm", required: false, confidence_threshold: 0.85,
    review_policy: "review_below", options: {} },
];

describe("AIDP — buildPredictionSchema", () => {
  it("Fixture 1 — happy path: builds a Zod object with one key per entity type", () => {
    const s = buildPredictionSchema(ETS);
    const parsed = s.parse({
      invoice_no: { value: "INV-1", confidence: 0.9 },
      total:      { value: 100,     confidence: 0.95 },
      due_date:   { value: "2025-01-01", confidence: 0.5 },
    });
    expect(parsed.invoice_no.value).toBe("INV-1");
  });
});

describe("AIDP — decideForField (review_policy)", () => {
  it("Fixture 2 — auto_accept policy auto-accepts regardless of confidence", () => {
    expect(decideForField("auto_accept", 0.1, 0.9)).toBe("auto_accept");
    expect(decideForField("auto_accept", 0.99, 0.9)).toBe("auto_accept");
  });
  it("Fixture 3 — review_below: high confidence auto-accepts, low routes to review", () => {
    expect(decideForField("review_below", 0.95, 0.85)).toBe("auto_accept");
    expect(decideForField("review_below", 0.40, 0.85)).toBe("review");
  });
  it("Fixture 4 — always_review never auto-accepts", () => {
    expect(decideForField("always_review", 0.99, 0.85)).toBe("review");
    expect(decideForField("always_review", 0.10, 0.85)).toBe("review");
  });
});

describe("AIDP — coerceValueColumns (per-field output type)", () => {
  it("Fixture 8 — writes string/number/date/json into the correct typed column", () => {
    expect(coerceValueColumns("string", "hello")).toMatchObject({ value_text: "hello", value_number: null, value_date: null });
    expect(coerceValueColumns("number", "1,234.50")).toMatchObject({ value_number: 1234.5 });
    expect(coerceValueColumns("currency", "$2,000.00")).toMatchObject({ value_number: 2000 });
    expect(coerceValueColumns("date", "2025-12-31")).toMatchObject({ value_date: "2025-12-31" });
    expect(coerceValueColumns("json", '{"a":1}')).toMatchObject({ value_json: { a: 1 } });
  });
});

describe("AIDP — structured response recovery", () => {
  it("accepts a fenced JSON object without weakening schema validation", () => {
    expect(parseStructuredPredictionText('```json\n{"account_number":{"value":"FVI-1","confidence":0.99}}\n```'))
      .toEqual({ account_number: { value: "FVI-1", confidence: 0.99 } });
    expect(parseStructuredPredictionText('I will extract it now.\n```json\n{"currency":{"value":"USD","confidence":0.98}}\n```\nDone.'))
      .toEqual({ currency: { value: "USD", confidence: 0.98 } });
    expect(() => parseStructuredPredictionText("not json")).toThrow();
  });

  it("drops only malformed optional bounding boxes", () => {
    expect(discardInvalidOptionalBboxes({
      account_id: { value: "FVI-1", confidence: 0.99, bbox: "page 1" },
      currency: { value: "USD", confidence: 0.98, bbox: { page: 1, x: 1, y: 2, w: 3, h: 4 } },
    })).toEqual({
      account_id: { value: "FVI-1", confidence: 0.99 },
      currency: { value: "USD", confidence: 0.98, bbox: { page: 1, x: 1, y: 2, w: 3, h: 4 } },
    });
  });

  it("estimates missing provider input usage conservatively from text", () => {
    expect(estimateAidpInputTokens("a".repeat(401))).toBe(101);
    expect(estimateAidpInputTokens("")).toBe(1);
  });

});

describe("AIDP — callPredictionModel", () => {
  it("Fixture 5 — happy path: returns model output for 3 entity types across 2 pages", async () => {
    const out = await callPredictionModel(
      { model_version_id: "platform-default", provider: "meta_ai_gateway", model: "google/gemini-3-flash-preview", api_key: "x", source: "platform_default" },
      ETS,
      [{ image_uri: "t/d/p0.png", page_index: 0 }, { image_uri: "t/d/p1.png", page_index: 1 }],
      async () => "https://signed.example/p.png",
    );
    expect(out.results.invoice_no.value).toBe("INV-001");
    expect(out.tokens_in).toBe(1200);
    expect(out.tokens_out).toBe(320);
  });

  it("sends Anthropic page images as validated bytes", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/messages")) {
        const requestBody = JSON.parse(String(init?.body));
        expect(requestBody.messages[0].content[0]).toMatchObject({
          type: "image",
          source: { type: "url", url: "https://signed.example/p.png" },
        });
        return new Response(JSON.stringify({
          content: [{
            type: "text",
            text: '```json\n{"invoice_no":{"value":"INV-001","confidence":0.99},"total":{"value":1234.5,"confidence":0.92},"due_date":{"value":"2025-12-31","confidence":0.4}}\n```',
          }],
          usage: { input_tokens: 100, output_tokens: 40 },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(new Uint8Array([137, 80, 78, 71]), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }) as typeof fetch;
    try {
      const out = await callPredictionModel(
        {
          model_version_id: "tenant-llm-default",
          provider: "anthropic",
          model: "claude-opus-5",
          api_key: "x",
          base_url: "https://proxy.example/v1",
          source: "document_type",
        },
        ETS,
        [{ image_uri: "t/d/p0.png", page_index: 0 }],
        async () => "https://signed.example/p.png",
      );
      expect(out.results.invoice_no.value).toBe("INV-001");
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "https://signed.example/p.png",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "https://proxy.example/v1/messages",
        expect.objectContaining({ method: "POST", signal: expect.any(AbortSignal) }),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("sends validated PDFs as native Anthropic document URLs", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/messages")) {
        const requestBody = JSON.parse(String(init?.body));
        expect(requestBody.messages[0].content[0]).toMatchObject({ type: "text" });
        expect(requestBody.messages[0].content[0].text).toContain("FVI-VALIDATION-001");
        expect(requestBody.messages[0].content[0].text).toContain("[Page 2]");
        return new Response(JSON.stringify({
          content: [{
            type: "text",
            text: '```json\n{"invoice_no":{"value":"INV-001","confidence":0.99},"total":{"value":1234.5,"confidence":0.92},"due_date":{"value":"2025-12-31","confidence":0.4}}\n```',
          }],
          usage: { input_tokens: 120, output_tokens: 40 },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(await readFile(new URL("../../tests/fixtures/fvi-assurance-multipage-bank-statement.pdf", import.meta.url)), {
        status: 200,
        headers: { "content-type": "application/pdf" },
      });
    }) as typeof fetch;
    try {
      const out = await callPredictionModel(
        {
          model_version_id: "platform-llm-default",
          provider: "anthropic",
          model: "claude-opus-5",
          api_key: "x",
          base_url: "https://proxy.example/v1",
          source: "platform_default",
        },
        ETS,
        [{ image_uri: "t/d/source.pdf", page_index: 0 }],
        async () => "https://signed.example/statement.pdf",
      );
      expect(out.results.total.value).toBe(1234.5);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("AIDP — provider failure path", () => {
  it("Fixture 7 — provider timeout surfaces as thrown error (caller writes aidp.predict.failed)", async () => {
    const { generateObject } = await import("ai");
    (generateObject as any).mockRejectedValueOnce(new Error("AbortError: 30s timeout"));
    await expect(callPredictionModel(
      { model_version_id: "platform-default", provider: "meta_ai_gateway", model: "x", api_key: "x", source: "platform_default" },
      ETS, [{ image_uri: "p", page_index: 0 }], async () => "u",
    )).rejects.toThrow(/timeout|abort/i);
  });
});

describe("AIDP — resolveModelVersion fallback chain", () => {
  const sbFactory = (rows: Record<string, any>) => {
    const makeChain = (table: string): any => {
      const chain: any = {
        eq: () => chain,
        in: () => chain,
        is: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({ data: rows[table] ?? null }),
        single: async () => ({ data: rows[table] ?? null }),
      };
      return chain;
    };
    return {
      from: (table: string) => ({
        select: () => makeChain(table),
      }),
    };
  };

  it("Fixture 6a — missing input falls back to document_type.default_model_version_id", async () => {
    const sb: any = sbFactory({
      aidp_document_types: { default_model_version_id: "11111111-1111-1111-1111-111111111111" },
      aidp_model_versions: { id: "11111111-1111-1111-1111-111111111111", provider: "anthropic", model: "claude-3-5-sonnet", base_url: "https://api.anthropic.com/v1", key_secret_name: "ANTHROPIC_API_KEY" },
    });
    process.env.ANTHROPIC_API_KEY = "test-key";
    const r = await resolveModelVersion(sb, "tenant", "dt1", undefined);
    expect(r.source).toBe("document_type");
    expect(r.provider).toBe("anthropic");
  });

  it("Fixture 6b — missing document_type default falls back to platform default (Meta AI Gateway)", async () => {
    process.env.META_API_KEY = "lk";
    const sb: any = sbFactory({
      aidp_document_types: { default_model_version_id: null },
      platform_ai_settings: { default_model: "google/gemini-3-flash-preview" },
    });
    const r = await resolveModelVersion(sb, "tenant", "dt1", undefined);
    expect(r.source).toBe("platform_default");
    expect(r.provider).toBe("fvi_ai");
    expect(r.model).toBe("google/gemini-3-flash-preview");
  });

  it("Fixture 6c — chooses the configured tenant provider and its vault binding", async () => {
    const sb: any = sbFactory({
      aidp_document_types: { default_model_version_id: null },
      llm_providers: {
        provider: "anthropic",
        model: "claude-opus-5",
        base_url: "https://proxy.example/v1",
        key_secret_name: "ANTHROPIC",
      },
    });
    const r = await resolveModelVersion(sb, "tenant", "dt1", undefined);
    expect(r.source).toBe("document_type");
    expect(r.provider).toBe("anthropic");
    expect(r.model).toBe("claude-opus-5");
    expect(r.base_url).toBe("https://proxy.example/v1");
    expect(r.api_key).toBe("vault-key");
  });
});
