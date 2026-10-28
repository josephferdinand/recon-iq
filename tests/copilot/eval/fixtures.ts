/**
 * Phase 3 (7b) — Copilot eval harness.
 *
 * 10 golden Q&A fixtures. Each fixture asserts the Copilot routes the
 * question to the right tool with the right shape — not the exact text
 * of the LLM reply (which is non-deterministic).
 *
 * In CI (without a live model), we exercise the *tool* directly through
 * the same `buildCopilotTools` registry the agent uses, so the fixtures
 * lock in the grounded contract that the Copilot promises to upstream
 * graders.
 */
export type EvalFixture = {
  id: string;
  question: string;
  expects_tool: string;
  /** Keys the tool output JSON must contain. */
  expects_keys: string[];
  /** Inputs to feed the tool directly when the LLM is bypassed. */
  tool_input: Record<string, unknown>;
};

export const FIXTURES: EvalFixture[] = [
  {
    id: "open-breaks",
    question: "How many open breaks?",
    expects_tool: "breaks_aging",
    expects_keys: ["buckets"],
    tool_input: {},
  },
  {
    id: "sla-risk",
    question: "What's the SLA risk right now?",
    expects_tool: "sla_at_risk",
    expects_keys: ["breaks_at_risk"],
    tool_input: { hours_until_breach: 24 },
  },
  {
    id: "recon-failure",
    question: "Why did recon RUN_ID fail yesterday?",
    expects_tool: "diagnose_recon_failure",
    expects_keys: ["run_summary", "failure_cause", "likely_root_causes", "similar_past_runs", "recommended_next_action"],
    tool_input: { recon_run_id: "00000000-0000-0000-0000-000000000000" },
  },
  {
    id: "cost-spike",
    question: "Which tenant had the biggest cost spike this week?",
    expects_tool: "cost_anomaly_alerter",
    expects_keys: ["current_week_cost_usd", "prior_week_cost_usd", "delta_pct", "top_tenant", "top_model"],
    tool_input: {},
  },
  {
    id: "schema-drift",
    question: "Did anything change about tenant T's reconciliation setup recently?",
    expects_tool: "schema_drift_detector",
    expects_keys: ["added", "removed", "modified", "first_drifted_at"],
    tool_input: { tenant_id: "00000000-0000-0000-0000-000000000000" },
  },
  {
    id: "policy-audit",
    question: "Which tenants are out of compliance with BYOK rotation or retention floor?",
    expects_tool: "policy_auditor",
    expects_keys: ["overdue_byok_rotation", "below_floor_retention", "expiring_step_up_grants", "missing_backups_24h"],
    tool_input: {},
  },
  {
    id: "cross-recon",
    question: "Are there reconciliations we could consolidate in tenant T?",
    expects_tool: "cross_recon_intelligence",
    expects_keys: ["duplicate_field_candidates", "consolidation_suggestions"],
    tool_input: { tenant_id: "00000000-0000-0000-0000-000000000000" },
  },
  {
    id: "repeat-breaks",
    question: "Which breaks keep repeating in the last 30 days?",
    expects_tool: "repeat_break_patterns",
    expects_keys: ["patterns"],
    tool_input: { days: 30 },
  },
  {
    id: "anomaly-scan",
    question: "Are there any anomalies in today's runs?",
    expects_tool: "anomaly_scan",
    expects_keys: ["anomalies"],
    tool_input: {},
  },
  {
    id: "recommend-fix",
    question: "What's the recommended fix for break BREAK_ID?",
    expects_tool: "recommend_fix",
    expects_keys: ["likely_cause", "suggested_actions"],
    tool_input: { break_id: "00000000-0000-0000-0000-000000000000" },
  },
];
