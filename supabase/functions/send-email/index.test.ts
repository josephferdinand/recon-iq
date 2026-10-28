import { buildConfirmationUrl, renderAuthEmail, resolveAuthEmailDeliveries } from "./index.ts";

const user = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "user@example.test",
  user_metadata: { full_name: "Joseph Ferdinand" },
};
const confirmationUrl = "https://app.reconiq.example/auth/reset?token=test&type=recovery";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("renders the complete password-only dual-theme email family", () => {
  const actions = [
    "signup",
    "recovery",
    "magic_link",
    "email_change",
    "invite",
    "reauthentication",
    "password_changed_notification",
  ];

  for (const action of actions) {
    const rendered = renderAuthEmail({
      user: action === "email_change" ? { ...user, new_email: "new@example.test" } : user,
      email_action_type: action,
      confirmation_url: confirmationUrl,
      email_data: action === "reauthentication" ? { token: "482716" } : undefined,
    });

    assert(rendered.subject.length > 0, `${action} subject is missing`);
    assert(rendered.text.length > 0, `${action} text fallback is missing`);
    assert(rendered.html.includes('name="color-scheme"'), `${action} lacks dual-theme metadata`);
    assert(rendered.html.includes("prefers-color-scheme: dark"), `${action} lacks dark-mode CSS`);
    assert(rendered.html.includes("Secure message"), `${action} lacks secure-message utility bar`);
    assert(
      rendered.html.includes('src="https://app.reconiq.example/fv-monogram.svg"'),
      `${action} does not use the approved raster logo URL`,
    );
    assert(
      rendered.html.includes('alt="ReconIQ aperture and wing symbol with ReconIQ wordmark"'),
      `${action} lacks the approved logo text alternative`,
    );
    assert(rendered.html.includes("Security notice"), `${action} lacks security guidance`);
    assert(rendered.html.includes("Bank-grade encryption"), `${action} lacks assurance footer`);
    assert(!rendered.html.includes("Google"), `${action} exposes Google sign-in`);
    assert(!rendered.html.includes("Request Access"), `${action} exposes public signup`);
  }
});

Deno.test("password change notification uses current address and contains no credentials or token", () => {
  const payload = {
    user: { ...user, new_email: "attacker-controlled@example.test" },
    email_action_type: "password_changed_notification",
    confirmation_url: "https://example.invalid/?token=must-not-appear",
    email_data: { email_action_type: "password_changed_notification", token: "must-not-appear" },
  };
  const deliveries = resolveAuthEmailDeliveries(payload, "https://example.supabase.co");
  assert(deliveries.length === 1, "password change notification should create exactly one delivery");
  assert(deliveries[0].recipient === user.email, "notification must go to the current email only");
  assert(deliveries[0].confirmationUrl === "", "security notice must not include a sign-in link");

  const rendered = renderAuthEmail(payload);
  assert(rendered.subject === "Your ReconIQ password was changed", "unexpected subject");
  assert(rendered.text.includes("account was changed"), "notice text is missing");
  assert(!rendered.html.includes("must-not-appear"), "HTML must not expose tokens or input links");
  assert(!rendered.text.includes("must-not-appear"), "text must not expose tokens or input links");
  assert(!rendered.html.includes("attacker-controlled@example.test"), "notice must not expose new email");
  assert(!rendered.text.includes("attacker-controlled@example.test"), "text must not expose new email");
});

Deno.test("recovery email matches the selected institutional hierarchy", () => {
  const rendered = renderAuthEmail({
    user,
    email_action_type: "recovery",
    confirmation_url: confirmationUrl,
  });

  assert(rendered.html.includes("Reset your password"), "recovery title is missing");
  assert(rendered.html.includes("Hello Joseph,"), "personalized greeting is missing");
  assert(rendered.html.includes("WHAT HAPPENS NEXT"), "recovery steps are missing");
  assert(rendered.html.includes("Open secure link"), "first recovery step is missing");
  assert(rendered.html.includes("Choose new password"), "second recovery step is missing");
  assert(rendered.html.includes("Return to ReconIQ"), "third recovery step is missing");
  assert(
    rendered.html.includes(confirmationUrl.replaceAll("&", "&amp;")),
    "fallback URL is missing",
  );
});

Deno.test("builds an actionable recovery link from the real Supabase hook fields", () => {
  const payload = {
    user,
    email_data: {
      token_hash: "recovery-token-hash",
      redirect_to: "https://app.reconiq.example/auth/reset",
      email_action_type: "recovery",
      site_url: "https://app.reconiq.example",
    },
  };
  const link = buildConfirmationUrl(payload, "https://example.supabase.co");
  const parsed = new URL(link);

  assert(parsed.origin === "https://app.reconiq.example", "wrong confirmation origin");
  assert(parsed.pathname === "/confirm-auth", "wrong confirmation path");
  assert(parsed.searchParams.get("token_hash") === "recovery-token-hash", "token hash is missing");
  assert(parsed.searchParams.get("type") === "recovery", "recovery type is missing");
  assert(
    parsed.searchParams.get("redirect_to") === "https://app.reconiq.example/auth/reset",
    "redirect target is missing",
  );

  const rendered = renderAuthEmail(payload, { confirmationUrl: link });
  assert(
    rendered.html.includes(link.replaceAll("&", "&amp;")),
    "generated recovery link is missing from HTML",
  );
  assert(rendered.text.includes(link), "generated recovery link is missing from plain text");
});

Deno.test("fails closed instead of sending a recovery email without a link", () => {
  let failed = false;
  try {
    renderAuthEmail({ user, email_action_type: "recovery" });
  } catch (error) {
    failed = String(error).includes("confirmation link unavailable");
  }
  assert(failed, "linkless recovery email was not rejected");
});

Deno.test("maps both secure email-change recipients to Supabase's reversed hashes", () => {
  const payload = {
    user: { ...user, new_email: "new@example.test" },
    email_data: {
      email_action_type: "email_change",
      token_hash: "hash-for-new-address",
      token_hash_new: "hash-for-current-address",
      redirect_to: "https://app.reconiq.example/auth/callback",
    },
  };
  const deliveries = resolveAuthEmailDeliveries(payload, "https://example.supabase.co");

  assert(deliveries.length === 2, "secure email change must produce two deliveries");
  assert(deliveries[0].recipient === user.email, "current-address delivery is missing");
  assert(
    deliveries[0].confirmationUrl.includes("hash-for-current-address"),
    "current-address hash is wrong",
  );
  assert(deliveries[1].recipient === "new@example.test", "new-address delivery is missing");
  assert(
    deliveries[1].confirmationUrl.includes("hash-for-new-address"),
    "new-address hash is wrong",
  );
});
