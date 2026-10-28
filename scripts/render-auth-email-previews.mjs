// Render pre-compiled .tsx->.js templates to HTML previews.
// Run: node scripts/render-auth-email-previews.mjs

import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const repoRoot = join(__dirname, '..')
const build = join(repoRoot, '.email-previews-build')
const out = join(repoRoot, '.claude/handover/email-previews')

const { render } = await import('@react-email/render')
const React = (await import('react')).default

const load = async (file) => {
  const mod = await import(pathToFileURL(join(build, file)).href)
  return mod
}

const Signup = (await load('signup.bundle.mjs')).SignupEmail
const Recovery = (await load('recovery.bundle.mjs')).RecoveryEmail
const Magic = (await load('magic-link.bundle.mjs')).MagicLinkEmail
const Invite = (await load('invite.bundle.mjs')).InviteEmail
const EmailChange = (await load('email-change.bundle.mjs')).EmailChangeEmail
const Reauth = (await load('reauthentication.bundle.mjs')).ReauthenticationEmail

if (!existsSync(out)) mkdirSync(out, { recursive: true })

const props = {
  common: {
    siteName: 'ReconIQ',
    siteUrl: 'https://app.reconiq.example',
  },
}

const cases = [
  {
    name: '01-signup',
    subject: 'Confirm your ReconIQ email',
    element: React.createElement(Signup, {
      ...props.common,
      recipient: 'joseph.ferdinand@reconiq.example',
      confirmationUrl:
        'https://app.reconiq.example/auth/confirm?token=abc123&type=signup',
    }),
  },
  {
    name: '02-recovery',
    subject: 'Reset your ReconIQ password',
    element: React.createElement(Recovery, {
      ...props.common,
      confirmationUrl:
        'https://app.reconiq.example/auth/reset?token=xyz789',
    }),
  },
  {
    name: '03-magic-link',
    subject: 'Your ReconIQ login link',
    element: React.createElement(Magic, {
      ...props.common,
      confirmationUrl:
        'https://app.reconiq.example/auth/magic?token=ml456',
    }),
  },
  {
    name: '04-invite',
    subject: "You've been invited to ReconIQ",
    element: React.createElement(Invite, {
      ...props.common,
      confirmationUrl: 'https://app.reconiq.example/invite/accept?token=inv000',
      inviterName: 'Joseph Ferdinand',
      tenantName: 'Acme Bank Corp',
    }),
  },
  {
    name: '05-email-change',
    subject: 'Confirm your ReconIQ email change',
    element: React.createElement(EmailChange, {
      ...props.common,
      oldEmail: 'joseph.ferdinand@reconiq.example',
      email: 'joseph.ferdinand@reconiq.example',
      newEmail: 'joseph@ferdinandprivate.com',
      confirmationUrl:
        'https://app.reconiq.example/auth/confirm?token=ec999',
    }),
  },
  {
    name: '06-reauthentication',
    subject: 'Your ReconIQ verification code',
    element: React.createElement(Reauth, { token: '492-815' }),
  },
]

const indexLines = []
for (const c of cases) {
  try {
    const html = await render(c.element, { pretty: true })
    const text = await render(c.element, { plainText: true })
    writeFileSync(join(out, `${c.name}.html`), html, 'utf8')
    writeFileSync(join(out, `${c.name}.txt`), text, 'utf8')
    const ok = /ReconIQ/.test(html) && /#1e3a5f/i.test(html)
    console.log(`[${ok ? 'OK' : 'WARN'}] ${c.name}  html=${html.length}b text=${text.length}b`)
    indexLines.push(`- [${c.name}](${c.name}.html) — ${c.subject}`)
  } catch (e) {
    console.error(`[FAIL] ${c.name}:`, e.message)
    process.exit(1)
  }
}

writeFileSync(
  join(out, 'README.md'),
  `# FVI Auth Email Previews\n\nSubject + rendered HTML for every Supabase Auth Hook event.\n\nOpen \`01-signup.html\` etc. in a browser to inspect.\n\n${indexLines.join('\n')}\n`,
  'utf8',
)

console.log(`\nWrote ${cases.length} previews to ${out}`)
