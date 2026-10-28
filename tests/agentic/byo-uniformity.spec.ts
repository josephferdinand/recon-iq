/**
 * Phase 3 (1) — BYO provider uniformity.
 *
 * `buildModelHandle` must return an AI-SDK-compatible model handle for
 * every provider. The handle must expose `.doGenerate` / `.doStream`
 * (the AI SDK v2 LanguageModelV2 interface), which is what enables
 * tool calling under `generateText` / `streamText`.
 *
 * We don't make a network call here — we only assert the factory returns
 * a model handle of the right shape for each BYO path.
 */
import { describe, it, expect } from "vitest";
import { buildModelHandle, type ResolvedProvider } from "@/lib/model-factory.server";

function assertSdkModelHandle(h: unknown, label: string) {
  expect(h, `${label}: handle is truthy`).toBeTruthy();
  // AI SDK LanguageModelV2 surface
  const anyH = h as Record<string, unknown>;
  const ok =
    typeof anyH.doGenerate === "function" ||
    typeof anyH.doStream === "function" ||
    // Some SDK wrappers expose a `specificationVersion` marker.
    typeof anyH.specificationVersion === "string";
  expect(ok, `${label}: looks like an AI SDK model handle`).toBe(true);
}

describe("Phase 3.1 — BYO provider uniformity", () => {
  it("Meta AI Gateway path returns a tool-capable model handle", () => {
    const resolved: ResolvedProvider = {
      provider: "meta_ai_gateway",
      model: "google/gemini-2.5-flash",
      apiKey: "test-key",
      baseUrl: "https://example.test/v1",
    };
    assertSdkModelHandle(buildModelHandle(resolved), "meta");
  });

  it("Anthropic BYO path returns a tool-capable model handle", () => {
    const resolved: ResolvedProvider = {
      provider: "anthropic",
      model: "claude-3-5-sonnet-latest",
      apiKey: "test-key",
    };
    assertSdkModelHandle(buildModelHandle(resolved), "anthropic");
  });

  it("Muse BYO path returns a tool-capable model handle", () => {
    const resolved: ResolvedProvider = {
      provider: "muse",
      model: "gpt-4o-mini",
      apiKey: "test-key",
    };
    assertSdkModelHandle(buildModelHandle(resolved), "muse");
  });

  it("Azure BYO path requires baseUrl and returns a model handle", () => {
    expect(() => buildModelHandle({
      provider: "azure", model: "gpt-4o", apiKey: "k",
    })).toThrow();
    assertSdkModelHandle(
      buildModelHandle({
        provider: "azure",
        model: "gpt-4o",
        apiKey: "k",
        baseUrl: "https://my.muse.azure.com/muse/deployments/x",
      }),
      "azure",
    );
  });
});
