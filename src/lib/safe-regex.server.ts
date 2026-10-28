// Server-only regex validator. Rejects patterns that contain classic ReDoS
// constructs (nested quantifiers on the same group) and caps overall length.

const MAX_PATTERN_LEN = 512;

// Catches `(a+)+`, `(.*)+`, `(?:foo|bar)*+` style nested quantifiers.
const NESTED_QUANTIFIER = /\((?:\?[^)]*)?[^()]*[+*][^()]*\)[+*]/;

// Catches `(a|a)*` style alternation-with-repetition (cheap heuristic).
const ALT_WITH_REPEAT = /\([^()]*\|[^()]*\)[+*]/;

export function assertSafeRegex(pattern: string): RegExp {
  if (typeof pattern !== "string") throw new Error("Regex must be a string");
  if (pattern.length > MAX_PATTERN_LEN) {
    throw new Error(`Regex too long (max ${MAX_PATTERN_LEN} chars)`);
  }
  if (NESTED_QUANTIFIER.test(pattern) || ALT_WITH_REPEAT.test(pattern)) {
    throw new Error("Regex rejected: contains catastrophic-backtracking pattern");
  }
  try {
    return new RegExp(pattern);
  } catch (e: any) {
    throw new Error(`Invalid regex: ${e?.message ?? "compile error"}`);
  }
}

export function safeTest(pattern: string, input: string, timeoutMs = 50): boolean {
  const re = assertSafeRegex(pattern);
  const start = Date.now();
  const result = re.test(input);
  // Best-effort wall-clock guard. If we ever exceed, log to console for ops.
  if (Date.now() - start > timeoutMs) {
    // eslint-disable-next-line no-console
    console.warn("[safe-regex] slow match", { pattern, ms: Date.now() - start });
  }
  return result;
}
