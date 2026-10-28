/**
 * ReconIQ Copilot — default reconciler semantic lexicon.
 *
 * Acts as the global fallback when a tenant has no `copilot_lexicon_overrides`
 * row. Mirrors the vocabulary baked into the Copilot system prompt so the
 * model and the natural-language → structured-filter translator agree.
 */
import type { SemanticLexicon } from "./copilot-semantics";

export const DEFAULT_LEXICON: SemanticLexicon = {
  statusSynonyms: {
    open: ["unresolved", "pending", "outstanding", "active break"],
    investigating: ["in review", "looking at", "wip"],
    pending_review: ["awaiting approval", "needs sign-off"],
    resolved: ["closed out", "fixed", "cleared"],
    closed: ["done", "completed"],
    active: ["live", "running", "in production"],
    paused: ["on hold", "suspended"],
  },
  timePhrases: [
    { pattern: /\b(today|so far today|since this morning)\b/i, since: "today" },
    { pattern: /\b(last\s*24\s*h(ours?)?|past\s*day|yesterday)\b/i, since: "24h" },
    { pattern: /\b(this\s*week|last\s*7\s*days?|past\s*week)\b/i, since: "7d" },
    { pattern: /\b(this\s*month|last\s*30\s*days?|past\s*month)\b/i, since: "30d" },
  ],
  severityAliases: {
    urgent: "critical",
    p1: "critical",
    blocker: "critical",
    important: "high",
    p2: "high",
    minor: "low",
    p3: "low",
    trivial: "low",
  },
  roleAliases: {
    boss: "tenant_admin",
    "head of ops": "tenant_admin",
    admin: "tenant_admin",
    "ops lead": "tenant_admin",
    reviewer: "tenant_reviewer",
    analyst: "tenant_member",
    user: "tenant_member",
  },
};
