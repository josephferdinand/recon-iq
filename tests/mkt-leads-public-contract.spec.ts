import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { publicLeadInput } from "@/lib/mkt-leads.functions";
import { parseNotifyRecipients } from "@/routes/api/public/mkt-leads";

const routeSource = readFileSync(resolve(process.cwd(), "src/routes/api/public/mkt-leads.ts"), "utf8");

const legacyLead = {
  first_name: "Ada",
  last_name: "Lovelace",
  email: "ada@example.com",
  company: "Analytical Engines",
  consent: true,
  source: "contact_form",
};

describe("public marketing lead API contract", () => {
  it("accepts the existing production client payload without plan or purpose", () => {
    const parsed = publicLeadInput.safeParse(legacyLead);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.purpose).toBeUndefined();
      expect(parsed.data.plan).toBeUndefined();
      expect(parsed.data.consent).toBe(true);
    }
  });

  it("accepts the new marketing form fields and keeps consent mandatory", () => {
    expect(publicLeadInput.safeParse({
      ...legacyLead,
      plan: "Enterprise",
      purpose: "Evaluate reconciliation automation",
    }).success).toBe(true);
    expect(publicLeadInput.safeParse({ ...legacyLead, consent: false }).success).toBe(false);
    expect(publicLeadInput.safeParse({ ...legacyLead, plan: "Unlisted plan" }).success).toBe(false);
  });

  it("derives a safe purpose for legacy clients and marks every response non-cacheable", () => {
    expect(routeSource).toContain('input.source === "book_demo" ? "Schedule a product demo" : "Website enquiry"');
    expect(routeSource).toContain('"cache-control": "no-store"');
    expect(routeSource).toContain("vary: \"Origin\"");
  });

  it("keeps database credentials server-side and does not return provider errors or PII", () => {
    expect(routeSource).toContain('await import("@/integrations/supabase/client.server")');
    expect(routeSource).not.toMatch(/VITE_[A-Z0-9_]*(SERVICE|SECRET|ROLE)_KEY/);
    expect(routeSource).not.toContain("error.message");
    expect(routeSource).toContain('error: "lead_submission_unavailable"');
  });

  it("reports accepted lead state separately from notification queue state", () => {
    expect(routeSource).toContain("lead_accepted: true");
    expect(routeSource).toContain("notification_queued_count: notificationQueuedCount");
    expect(routeSource).toContain("notification_recipient_count: notificationRecipients.length");
    expect(routeSource).not.toContain("email delivered");
  });

  it("defaults to both approved recipients and normalizes a configured list", () => {
    expect(parseNotifyRecipients(undefined)).toEqual([
      "support@reconiq.example",
      "joseph.ferdinand@reconiq.example",
    ]);
    expect(parseNotifyRecipients(" Support@ReconIQ.com, joseph.ferdinand@reconiq.example, SUPPORT@reconiq.example ")).toEqual([
      "support@reconiq.example",
      "joseph.ferdinand@reconiq.example",
    ]);
  });

  it("fails closed for external, malformed, empty, or excessive recipient configuration", () => {
    expect(parseNotifyRecipients("support@reconiq.example,outsider@example.com")).toEqual([]);
    expect(parseNotifyRecipients("support@reconiq.example,")).toEqual([]);
    expect(parseNotifyRecipients("")).toEqual([]);
    expect(parseNotifyRecipients("one@reconiq.example,two@reconiq.example,three@reconiq.example,four@reconiq.example,five@reconiq.example,six@reconiq.example")).toEqual([]);
  });
});
