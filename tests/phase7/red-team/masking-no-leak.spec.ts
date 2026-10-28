/**
 * Red-team probe — masking strategies must never echo the original value.
 * This is the seed test in the adversarial suite executed by the
 * `red-team-scan` GitHub workflow.
 */
import { describe, it, expect } from "vitest";
import { applyMask } from "@/lib/phase7-drift-masking.functions";

describe("red-team / masking strategies do not leak originals", () => {
  const samples = [
    "4242424242424242",
    "alice@example.com",
    "P@ssw0rd!2024",
    "+1 415 555 0100",
    "987-65-4321",
  ];
  const strategies = ["redact","hash","last4","email_local","truncate","null"] as const;

  for (const s of samples) {
    for (const strat of strategies) {
      it(`does not echo ${strat} value for "${s}"`, () => {
        const out = applyMask(s, strat);
        if (out === null) return;
        expect(String(out)).not.toBe(s);
      });
    }
  }
});
