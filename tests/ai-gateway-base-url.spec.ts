// E2 — Lift hardcoded Meta AI gateway base URL to llm_providers.
import { describe, it, expect } from "vitest";
import { resolveMetaGatewayBaseUrl, META_AI_GATEWAY_DEFAULT_BASE_URL } from "@/lib/ai-gateway.server";

function sb(row: { base_url?: string } | null) {
  return {
    from() {
      const api: any = {
        select() { return api; }, eq() { return api; }, order() { return api; },
        limit() { return api; }, maybeSingle: async () => ({ data: row, error: null }),
      };
      return api;
    },
  } as any;
}

describe("resolveMetaGatewayBaseUrl", () => {
  it("uses base_url from llm_providers when row exists", async () => {
    const url = await resolveMetaGatewayBaseUrl(sb({ base_url: "https://custom.example.com/v1" }));
    expect(url).toBe("https://custom.example.com/v1");
  });

  it("falls back to hardcoded default when no row exists", async () => {
    const url = await resolveMetaGatewayBaseUrl(sb(null));
    expect(url).toBe(META_AI_GATEWAY_DEFAULT_BASE_URL);
  });
});
