import { BRAND } from "@/lib/email-templates/brand-shell";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] ?? character);
}

/** The exact approved raster logo is shared by every queued ReconIQ notification. */
export function renderBrandedQueueEmail(subject: string, body: string) {
  const safeBody = escapeHtml(body).replace(/\r?\n/gu, "<br />");
  return `<!doctype html><html lang="en"><body style="margin:0;background:#f5f7fa;font-family:Arial,sans-serif;color:#14243a"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7fa"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border:1px solid #dce4ed;border-radius:14px"><tr><td style="background:#102743;padding:18px 24px"><img src="${escapeHtml(BRAND.approvedLogoUrl)}" width="112" height="112" alt="ReconIQ" style="display:block;background:#fff;border:0;border-radius:8px;object-fit:contain" /></td></tr><tr><td style="padding:28px"><h1 style="font-size:22px;line-height:1.25;margin:0 0 18px;color:#14243a">${escapeHtml(subject)}</h1><p style="font-size:15px;line-height:1.6;margin:0;color:#334155">${safeBody}</p><p style="font-size:12px;line-height:1.5;margin:28px 0 0;color:#64748b">ReconIQ · Secure account notification</p></td></tr></table></td></tr></table></body></html>`;
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
