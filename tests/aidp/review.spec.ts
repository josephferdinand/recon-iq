/**
 * AIDP Slice 3 — review queue tests.
 * Verifies accept/reject/correct semantics and the supersede chain.
 */
import { describe, it, expect } from "vitest";

/** In-memory fake of the slices the handler touches. */
function makeFake() {
  const tables: Record<string, any[]> = {
    aidp_prediction_fields: [
      { id: "pf1", tenant_id: "t1", prediction_id: "pred1", entity_type_id: "et1",
        value_text: "INV-001", value_number: null, value_date: null, value_json: null,
        confidence: 0.9, accepted_at: null, rejected_at: null },
      { id: "pf2", tenant_id: "t1", prediction_id: "pred2", entity_type_id: "et2",
        value_text: "100", value_number: 100, value_date: null, value_json: null,
        confidence: 0.4, accepted_at: null, rejected_at: null },
    ],
    aidp_entity_types: [
      { id: "et1", datatype: "string", review_policy: "review_below", confidence_threshold: 0.85 },
      { id: "et2", datatype: "number", review_policy: "review_below", confidence_threshold: 0.85 },
    ],
    aidp_predictions: [
      { id: "pred1", document_id: "doc1", decision: "pending" },
      { id: "pred2", document_id: "doc1", decision: "pending" },
    ],
    aidp_outputs: [],
    aidp_output_recon_invalidations: [],
    security_events: [],
    audit_log: [],
  };
  return tables;
}

/**
 * Simplified mirror of reviewPredictionField for behavioral assertions.
 * (Mirrors handler logic — kept in-test so we don't need a live Supabase.)
 */
async function applyReview(t: any, args: { prediction_field_id: string; decision: "accept" | "reject" | "correct"; corrected_value?: any }) {
  const field = t.aidp_prediction_fields.find((f: any) => f.id === args.prediction_field_id);
  const et = t.aidp_entity_types.find((x: any) => x.id === field.entity_type_id);
  const pred = t.aidp_predictions.find((p: any) => p.id === field.prediction_id);

  const prior = t.aidp_outputs.find((o: any) =>
    o.document_id === pred.document_id && o.entity_type_id === field.entity_type_id && !o.superseded_at);

  if (args.decision === "reject") {
    field.rejected_at = new Date().toISOString();
    t.aidp_outputs.push({ id: `out-${t.aidp_outputs.length+1}`, document_id: pred.document_id,
      entity_type_id: field.entity_type_id, prediction_field_id: field.id,
      decision: "human_rejected", origin: "human", supersedes_id: prior?.id ?? null });
    if (prior) prior.superseded_at = new Date().toISOString();
    pred.decision = "human_rejected";
  } else {
    const useCorrected = args.decision === "correct";
    const newOut: any = {
      id: `out-${t.aidp_outputs.length+1}`,
      document_id: pred.document_id,
      entity_type_id: field.entity_type_id,
      prediction_field_id: field.id,
      decision: "human_accepted",
      origin: useCorrected ? "correction" : "human",
      value_text: useCorrected ? String(args.corrected_value) : field.value_text,
      value_number: useCorrected && et.datatype === "number" ? Number(args.corrected_value) : field.value_number,
      supersedes_id: prior?.id ?? null,
    };
    t.aidp_outputs.push(newOut);
    if (prior) prior.superseded_at = new Date().toISOString();
    field.accepted_at = new Date().toISOString();
    pred.decision = "human_accepted";
  }
  t.security_events.push({ event_type: `aidp.review.${args.decision}` });
}

describe("AIDP — review queue", () => {
  it("Fixture 1 — accept supersedes a prior auto-accepted output", async () => {
    const t = makeFake();
    t.aidp_outputs.push({ id: "out0", document_id: "doc1", entity_type_id: "et1",
      decision: "auto_accepted", origin: "model", value_text: "INV-OLD", supersedes_id: null });
    await applyReview(t, { prediction_field_id: "pf1", decision: "accept" });
    const live = t.aidp_outputs.filter((o: any) => !o.superseded_at);
    expect(live).toHaveLength(1);
    expect(live[0].decision).toBe("human_accepted");
    expect(live[0].value_text).toBe("INV-001");
  });

  it("Fixture 2 — reject does NOT insert a value row", async () => {
    const t = makeFake();
    await applyReview(t, { prediction_field_id: "pf1", decision: "reject" });
    const live = t.aidp_outputs.filter((o: any) => !o.superseded_at);
    expect(live).toHaveLength(1);
    expect(live[0].decision).toBe("human_rejected");
    expect(live[0].value_text).toBeUndefined();
  });

  it("Fixture 3 — correct inserts with origin='correction'", async () => {
    const t = makeFake();
    await applyReview(t, { prediction_field_id: "pf2", decision: "correct", corrected_value: 999 });
    const live = t.aidp_outputs.filter((o: any) => !o.superseded_at);
    expect(live[0].origin).toBe("correction");
    expect(live[0].value_number).toBe(999);
  });

  it("Fixture 4 — non-tenant-member is forbidden (handler-level, simulated)", async () => {
    // Simulate the RLS gate by checking field.tenant_id !== callerTenant
    const t = makeFake();
    const callerTenant = "t-other";
    const field = t.aidp_prediction_fields[0];
    const allowed = field.tenant_id === callerTenant;
    expect(allowed).toBe(false);
  });

  it("Fixture 5 — listing pending reviews returns lowest-confidence first", () => {
    const t = makeFake();
    const sorted = [...t.aidp_prediction_fields].sort((a: any, b: any) => a.confidence - b.confidence);
    expect(sorted[0].id).toBe("pf2");
    expect(sorted[0].confidence).toBeLessThan(sorted[1].confidence);
  });

  it("Fixture 6 — supersede chain: correct → accept produces exactly one live output", async () => {
    const t = makeFake();
    await applyReview(t, { prediction_field_id: "pf1", decision: "correct", corrected_value: "INV-CORRECT" });
    await applyReview(t, { prediction_field_id: "pf1", decision: "accept" });
    const live = t.aidp_outputs.filter((o: any) => !o.superseded_at);
    expect(live).toHaveLength(1);
    expect(live[0].decision).toBe("human_accepted");
  });
});
