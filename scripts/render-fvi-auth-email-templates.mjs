/**
 * Render the exact production Supabase Auth email renderer into a local proof
 * gallery. The imported Edge Function is guarded by import.meta.main, so this
 * script reuses production HTML without starting the function server.
 *
 * Run: deno run --allow-write scripts/render-fvi-auth-email-templates.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { renderAuthEmail } from "../supabase/functions/send-email/index.ts";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const outputDirectory = join(scriptDirectory, "..", ".claude", "handover", "zeptomail-proof");
const user = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "joseph@example-bank.test",
  user_metadata: { full_name: "Joseph Ferdinand" },
};
const confirmationUrl = "https://app.reconiq.example/auth/reset?token=proof-token&type=recovery";

const fixtures = [
  {
    file: "01-account-confirmation",
    action: "signup",
    payload: { user, email_action_type: "signup", confirmation_url: confirmationUrl },
  },
  {
    file: "02-password-recovery",
    action: "recovery",
    payload: { user, email_action_type: "recovery", confirmation_url: confirmationUrl },
  },
  {
    file: "03-one-time-sign-in",
    action: "magic_link",
    payload: { user, email_action_type: "magic_link", confirmation_url: confirmationUrl },
  },
  {
    file: "04-email-change",
    action: "email_change",
    payload: {
      user: { ...user, new_email: "joseph.new@example-bank.test" },
      email_action_type: "email_change",
      confirmation_url: confirmationUrl,
    },
  },
  {
    file: "05-invitation",
    action: "invite",
    payload: { user, email_action_type: "invite", confirmation_url: confirmationUrl },
  },
  {
    file: "06-reauthentication",
    action: "reauthentication",
    payload: {
      user,
      email_action_type: "reauthentication",
      email_data: { token: "482 716", email_action_type: "reauthentication" },
    },
  },
];

mkdirSync(outputDirectory, { recursive: true });
const galleryEntries = [];

for (const fixture of fixtures) {
  const rendered = renderAuthEmail(fixture.payload);
  const htmlFile = `${fixture.file}.html`;
  const textFile = `${fixture.file}.txt`;
  writeFileSync(join(outputDirectory, htmlFile), rendered.html, "utf8");
  writeFileSync(join(outputDirectory, textFile), rendered.text, "utf8");
  galleryEntries.push({ ...fixture, htmlFile, subject: rendered.subject });
  console.log(`${fixture.action}: ${rendered.subject}`);
}

const cards = galleryEntries
  .map(
    (entry) => `<section class="proof-card">
      <header><strong>${entry.action}</strong><span>${entry.subject}</span></header>
      <iframe title="${entry.action} email proof" src="${entry.htmlFile}"></iframe>
    </section>`,
  )
  .join("\n");

const gallery = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>FVI Auth Email Proof Gallery</title>
  <style>
    :root { color-scheme: light; font-family: Inter, system-ui, sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #eef2f6; color: #10213a; }
    main { width: min(1500px, 100%); margin: 0 auto; padding: 32px 20px 80px; }
    h1 { margin: 0; font: 700 32px/1.2 Georgia, serif; }
    .intro { margin: 8px 0 28px; color: #59677a; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(620px, 1fr)); gap: 24px; }
    .proof-card { overflow: hidden; border: 1px solid #d8dee8; border-radius: 12px; background: white; box-shadow: 0 12px 32px rgba(11,37,69,.08); }
    .proof-card header { display: flex; justify-content: space-between; gap: 16px; padding: 14px 16px; background: #081d35; color: white; font-size: 13px; }
    .proof-card header strong { color: #55d3dd; text-transform: uppercase; letter-spacing: .08em; }
    iframe { display: block; width: 100%; height: 1050px; border: 0; background: #f3f6fa; }
  </style>
</head>
<body><main>
  <h1>ReconIQ Auth Email System</h1>
  <p class="intro">Production renderer proofs · owner-selected institutional light theme · dark-mode CSS included</p>
  <div class="grid">${cards}</div>
</main></body>
</html>`;

writeFileSync(join(outputDirectory, "index.html"), gallery, "utf8");
console.log(`Wrote ${fixtures.length} production-renderer proofs to ${outputDirectory}`);
