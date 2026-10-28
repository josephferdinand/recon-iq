import { describe, it, expect } from "vitest";
import { getLexiconForTenant, DEFAULT_LEXICON } from "@/lib/copilot-semantics";

describe("semantic lexicon", () => {
  it("returns the default lexicon when no tenant override is present", async () => {
    const lex = await getLexiconForTenant(null, null);
    expect(lex).toBe(DEFAULT_LEXICON);
    expect(lex.statusSynonyms.open).toContain("unresolved");
    expect(lex.severityAliases.urgent).toBe("critical");
    expect(lex.roleAliases.boss).toBe("tenant_admin");
    expect(lex.timePhrases.some((t) => t.pattern.test("last 7 days"))).toBe(true);
  });
});
