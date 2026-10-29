import { describe, expect, it } from "vitest";
import { renderBrandedQueueEmail, signupAdmissionNotice } from "@/lib/email-templates/queue-brand";

describe("queued email branding", () => {
  it("uses the exact approved logo and escapes notification data", () => {
    const html = renderBrandedQueueEmail("Admission <approved>", "Hello & welcome\nReview <request>");
    expect(html).toContain("https://reconintelligence.app/rq-seal.svg");
    expect(html).toContain("alt=\"ReconIQ monogram\"");
    expect(html).toContain("Admission &lt;approved&gt;");
    expect(html).toContain("Hello &amp; welcome<br />Review &lt;request&gt;");
    expect(html).not.toContain("<request>");
    expect(html).not.toContain("#102743"); // retired navy queue shell must not return
  });
});

describe("signup admission notifications", () => {
  it("distinguishes verification and pending approval from granted access", () => {
    const pending = signupAdmissionNotice("signup.admission_requested", "applicant", "Test User");
    expect(pending.body).toContain("before any workspace access is granted");
    const admin = signupAdmissionNotice("signup.admission_requested", "admin", "Test User");
    expect(admin.body).toContain("Signup admissions queue");
    expect(admin.body).toContain("No access has been granted");
    const approved = signupAdmissionNotice("signup.admission_approved", "applicant", "Test User");
    expect(approved.body).toContain("approved");
    const denied = signupAdmissionNotice("signup.admission_denied", "applicant", "Test User");
    expect(denied.body).toContain("No workspace access was granted");
  });
});
