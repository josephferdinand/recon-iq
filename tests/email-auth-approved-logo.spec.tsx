import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { renderAuthEmail } from "../src/lib/email-templates/render";

const logoUrl = "https://app.reconiq.example/fv-monogram.svg";
const confirmationUrl = "https://app.reconiq.example/auth/confirm?token=mail-proof&type=signup";

const actions = [
  { action: "signup", heading: "Confirm your email", button: "Verify email" },
  { action: "recovery", heading: "Reset your password", button: "Reset password" },
  { action: "magic_link", heading: "Your login link", button: "Log in" },
  { action: "invite", heading: "You’re invited", button: "Accept invitation" },
  { action: "email_change", heading: "Confirm your email change", button: "Confirm email change" },
  { action: "reauthentication", heading: "Confirm it’s you", button: null },
  { action: "password_changed_notification", heading: "Your password was changed", button: null },
] as const;

describe("transactional auth email approved logo", () => {
  it("keeps the ReconIQ monogram master available to the email build", () => {
    const logo = readFileSync("public/fv-monogram.svg", "utf8");
    expect(logo).toContain("<svg");
    expect(logo).toContain(">RQ</text>");
  });

  it.each(actions)(
    "renders the approved logo and preserved $action message",
    async ({ action, heading, button }) => {
      const rendered = await renderAuthEmail({
        user: {
          id: "00000000-0000-4000-8000-000000000001",
          email: "joseph@example.test",
          new_email: "joseph.new@example.test",
          old_email: "joseph@example.test",
        },
        email_action_type: action,
        confirmation_url: confirmationUrl,
        email_data: { token: "482 716" },
      });

      expect(rendered.html).toContain(`src="${logoUrl}"`);
      expect(rendered.html).toContain('width="128"');
      expect(rendered.html).toContain('height="128"');
      expect(rendered.html).toContain('alt="ReconIQ monogram"');
      // Adjacent semantic text remains visible if the email client blocks images.
      expect(rendered.html).toContain("ReconIQ");
      expect(rendered.html).toContain(heading);
      expect(rendered.html).toContain("ReconIQ. All rights");

      if (button) {
        expect(rendered.html).toContain(button);
        expect(rendered.html).toContain("token=mail-proof");
        expect(rendered.text).toContain("token=mail-proof");
      } else if (action === "reauthentication") {
        expect(rendered.html).toContain("482 716");
        expect(rendered.text).toContain("482 716");
      } else {
        expect(rendered.html).not.toContain("mail-proof");
        expect(rendered.text).not.toContain("mail-proof");
      }
    },
  );
});
