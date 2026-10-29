import { BRAND } from "@/lib/email-templates/brand-shell";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] ?? character);
}

/**
 * Queued-notification email shell. Mirrors the BrandShell used by the
 * transactional auth emails (Onyx: black header band, RQ seal in a white
 * chip, white body card, muted footer) so every ReconIQ email — queued or
 * transactional — carries the same identity. Subject and body are always
 * HTML-escaped; newlines in the body become line breaks.
 */
export function renderBrandedQueueEmail(subject: string, body: string) {
  const safeBody = escapeHtml(body).replace(/\r?\n/gu, "<br />");
  const logoUrl = escapeHtml(BRAND.approvedLogoUrl);
  const siteUrl = escapeHtml(BRAND.marketingSite);
  const supportEmail = escapeHtml(BRAND.supportEmail);
  return `<!doctype html><html lang="en"><body style="margin:0;background:#f5f5f7;font-family:Inter,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#1d1d1f"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7"><tr><td align="center" style="padding:32px 12px"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #e5e5ea;border-radius:12px"><tr><td style="background:#000000;background:linear-gradient(135deg,#1d1d1f 0%,#000000 100%);padding:24px 28px;border-radius:12px 12px 0 0"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="vertical-align:middle;padding-right:14px"><span style="display:inline-block;background:#ffffff;border-radius:8px;padding:6px"><img src="${logoUrl}" width="44" height="44" alt="ReconIQ monogram" style="display:block;border:0" /></span></td><td style="vertical-align:middle"><span style="display:block;font-size:18px;font-weight:700;color:#ffffff;letter-spacing:-0.01em;line-height:1.2">ReconIQ</span><span style="display:block;font-size:11px;color:#a1a1a6;line-height:1.4">Secure account notification</span></td></tr></table></td></tr><tr><td style="padding:32px 28px"><h1 style="font-size:22px;line-height:1.25;margin:0 0 18px;color:#1d1d1f">${escapeHtml(subject)}</h1><p style="font-size:15px;line-height:1.6;margin:0;color:#1d1d1f">${safeBody}</p></td></tr><tr><td style="border-top:1px solid #e5e5ea;padding:18px 28px;text-align:center"><p style="font-size:12px;line-height:1.5;margin:0;color:#6e6e73">ReconIQ &middot; Secure account notification<br /><a href="${siteUrl}" style="color:#1d1d1f;text-decoration:underline">reconintelligence.app</a> &middot; <a href="mailto:${supportEmail}" style="color:#1d1d1f;text-decoration:underline">${supportEmail}</a></p></td></tr></table></td></tr></table></body></html>`;
}

export function signupAdmissionNotice(
  event: "signup.admission_requested" | "signup.admission_approved" | "signup.admission_denied",
  recipient: "admin" | "applicant",
  fullName: string,
) {
  if (event === "signup.admission_requested") {
    return recipient === "admin"
      ? {
          subject: "ReconIQ admission request awaiting review",
          body: `${fullName} verified a work email and requested access to your tenant. Review the Signup admissions queue in Tenant Administration. No access has been granted.`,
        }
      : {
          subject: "Your ReconIQ admission request is pending",
          body: "Your work email was verified. Your tenant administrator must review your request before any workspace access is granted.",
        };
  }
  if (event === "signup.admission_approved") {
    return {
      subject: "Your ReconIQ admission was approved",
      body: "Your tenant administrator approved your admission. You can now sign in to ReconIQ. Your access remains limited to the permissions assigned in your tenant.",
    };
  }
  return {
    subject: "Your ReconIQ admission request was not approved",
    body: "Your tenant administrator did not approve this admission request. No workspace access was granted. Contact your organization administrator if you believe this is an error.",
  };
}
