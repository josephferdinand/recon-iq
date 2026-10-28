import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { publicLeadInput } from "@/lib/mkt-leads.functions";
import { parsePublicLeadResponse, publicLeadEndpoint } from "@/lib/public-lead-client";

const validLead = {
  first_name: "Ada",
  last_name: "Lovelace",
  email: "ada@example.com",
  mobile: "+1 555 0100",
  company: "Analytical Engines",
  plan: "Enterprise",
  purpose: "Request a pricing discussion",
  consent: true,
};

describe("marketing public lead contract", () => {
  it("routes the public marketing apex to the app API using an absolute URL", () => {
    expect(publicLeadEndpoint("https://reconiq.example")).toBe(
      "https://app.reconiq.example/api/public/mkt-leads",
    );
    expect(publicLeadEndpoint("https://www.reconiq.example")).toBe(
      "https://app.reconiq.example/api/public/mkt-leads",
    );
  });

  it("keeps local and preview submissions off the production app", () => {
    expect(publicLeadEndpoint("http://localhost:5173")).toBe(
      "http://localhost:5173/api/public/mkt-leads",
    );
    expect(publicLeadEndpoint("https://YOUR_PROJECT.pages.dev", "https://dev.app.reconiq.example"))
      .toBe("https://dev.app.reconiq.example/api/public/mkt-leads");
    expect(() => publicLeadEndpoint("https://YOUR_PROJECT.pages.dev", "https://app.reconiq.example"))
      .toThrow("Non-production marketing cannot submit to the production app.");
    expect(() => publicLeadEndpoint("https://YOUR_PROJECT.pages.dev"))
      .toThrow("Marketing API environment is not configured.");
  });

  it("requires a non-empty purpose and accepts the selected plan", () => {
    expect(publicLeadInput.safeParse(validLead).success).toBe(true);
    expect(publicLeadInput.safeParse({ ...validLead, plan: "Growth" }).success).toBe(false);
    expect(publicLeadInput.safeParse({ ...validLead, purpose: "   " }).success).toBe(false);
    const { purpose: _purpose, ...withoutPurpose } = validLead;
    expect(publicLeadInput.safeParse(withoutPurpose).success).toBe(false);
  });

  it("turns non-JSON and unsuccessful responses into safe user-facing errors", async () => {
    await expect(parsePublicLeadResponse(new Response("<html>not found</html>", { status: 404 })))
      .rejects.toThrow("We could not submit your request.");
    await expect(parsePublicLeadResponse(new Response(JSON.stringify({ error: "rate_limit_exceeded" }), { status: 429 })))
      .rejects.toThrow("Too many requests.");
  });

  it("keeps server-side rate limiting fail-closed and email notification best-effort with activity", async () => {
    const source = await readFile(new URL("../src/routes/api/public/mkt-leads.ts", import.meta.url), "utf8");
    expect(source).toContain('admin.rpc("rate_limit_hit"');
    expect(source).toContain('return json({ error: "rate_limit_unavailable" }, 503, origin)');
    expect(source).toContain('admin.rpc("enqueue_email"');
    expect(source).toContain('to: "support@reconiq.example"');
    expect(source).toContain('"support_notification.queued" : "support_notification.failed"');
  });
});
