import { describe, expect, it } from "vitest";
import { providerTestGuidance } from "@/routes/mkt-admin/ai-models";

describe("AI model provider test guidance", () => {
  it.each([
    [0, "disabled", /disabled.*enable/i],
    [0, "missing base_url", /URL is required.*base URL/i],
    [0, "missing vault secret (api_key_ref)", /vault secret reference is missing.*environment variable name/i],
    [401, undefined, /did not accept.*credentials.*check/i],
    [429, undefined, /temporarily limiting.*wait/i],
    [503, undefined, /temporarily unavailable.*try again/i],
  ])("gives safe next steps for status %s", (status, detail, expected) => {
    expect(providerTestGuidance(status, detail)).toMatch(expected);
  });

  it("never includes unknown provider response text", () => {
    const raw = "API key sk-example leaked; internal upstream response body";
    const guidance = providerTestGuidance(500, raw);

    expect(guidance).toMatch(/temporarily unavailable.*try again/i);
    expect(guidance).not.toContain(raw);
    expect(guidance).not.toContain("sk-example");
  });
});
