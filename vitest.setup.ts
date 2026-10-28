// Deterministic unit-test-only runtime defaults. Production secrets are never
// loaded by Vitest; live Supabase/browser suites use separate explicit gates.
process.env.APP_DATA_ENC_KEY ??= "fvi-unit-test-key-2026-not-for-production";

if (typeof window !== "undefined") {
  Object.defineProperty(window, "scrollTo", { value: () => undefined, writable: true });
}
