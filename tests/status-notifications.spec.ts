import { describe, it, expect, vi } from "vitest";
import { deliverConfirmedStatusUpdate, type StatusDeliveryClaim } from "@/lib/status-notifications.server";
import { statusPrototypeSnapshot } from "@/lib/status-prototype-data";
const consent: StatusDeliveryClaim = { lease_id: "fixture-lease", subscriber_id: "fixture-subscriber", email: "fixture@example.invalid", verified_at: "2025-01-01T00:00:00Z", consent_method: "verified_email_link", confirmation_provider_receipt: "fixture-receipt", unsubscribed: false, component_keys: [] };
const dependencies = (change: Partial<StatusDeliveryClaim> = {}) => ({ parentQaApproved: true,
  claim: vi.fn().mockResolvedValue(consent), currentConsent: vi.fn().mockResolvedValue({ ...consent, ...change }), settle: vi.fn().mockResolvedValue(undefined),
  zepto: { apiToken: "synthetic-fixture-only", from: { email: "fixture@example.invalid" } }, send: vi.fn().mockResolvedValue({ messageId: "fixture-provider-id" }) });
describe("status notification consent and QA boundary", () => {
  it("does not send or claim a recipient before parent QA", async () => {
    const mock = dependencies(); expect(await deliverConfirmedStatusUpdate({}, { ...mock, parentQaApproved: false })).toEqual({ state: "held_for_parent_qa" });
    expect(mock.claim).not.toHaveBeenCalled(); expect(mock.send).not.toHaveBeenCalled();
  });
  it("requires current verified email delivery evidence, scope and unrevoked consent", async () => {
    const event = statusPrototypeSnapshot(true).incidents[0];
    for (const change of [{ verified_at: null }, { verified_at: "invalid-time" }, { confirmation_provider_receipt: null }, { unsubscribed: true }, { component_keys: ["unrelated"] }]) {
      const mock = dependencies(change); expect((await deliverConfirmedStatusUpdate(event, mock)).state).toBe("suppressed"); expect(mock.send).not.toHaveBeenCalled();
    }
  });
  it("uses only the existing Zepto adapter and does not retry an uncertain result", async () => {
    const event = statusPrototypeSnapshot(true).incidents[0]; const mock = dependencies(); mock.send.mockRejectedValue(new Error("synthetic private provider diagnostic"));
    expect((await deliverConfirmedStatusUpdate(event, mock)).state).toBe("uncertain"); expect(mock.send).toHaveBeenCalledTimes(1); expect(mock.settle).toHaveBeenCalledWith("fixture-lease", "uncertain");
  });
  it("preserves provider acceptance when durable receipt confirmation is lost",async()=>{
    const mock=dependencies();mock.settle.mockRejectedValue(new Error("Synthetic lost receipt"));
    expect((await deliverConfirmedStatusUpdate(statusPrototypeSnapshot(true).incidents[0],mock)).state).toBe("provider_accepted_receipt_unconfirmed");
    expect(mock.send).toHaveBeenCalledTimes(1);expect(mock.settle).toHaveBeenCalledTimes(1);
  });
});
