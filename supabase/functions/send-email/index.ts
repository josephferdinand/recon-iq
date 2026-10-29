// ReconIQ Supabase Auth Hook — Send Email (v3 — bold redesign, 2026-08-22)
//
// Renders rich, brand-aligned ReconIQ transactional emails and sends them via
// ZeptoMail's HTTP API on the India region (`api.zeptomail.in`).
//
// Brand spec (see BRAND.md §3-4):
//   - Primary:    #1e3a5f (deep brand blue)
//   - Primary light: #3b5f87
//   - Accent:      #00d4ff (cyan)
//   - Background:  #f4f6fa (ReconIQ off-white)
//   - Surface:     #ffffff
//   - Text:        #0a0e1a (near-black)
//   - Muted:       #6b7280
//   - Success:     #10b981
//   - Tagline:     "Recon, exceptions, and agentic AI on one ledger of truth."
//
// Templates in this file: signup, recovery, magic_link, email_change, invite,
// reauthentication, and post-change security notifications. Each renders an identical chrome (gradient header band + body
// card + structured CTA + footer) so recipients get a consistent ReconIQ experience.

// `declare const Deno` is TS-only syntax; in Deno runtime Deno is a real global.
// eslint-disable-next-line @typescript-eslint/no-namespace
declare const Deno: any

// LL-088 (2026-08-23): Use standardwebhooks@1.0.0 to verify the auth-hook signature.
// The Supabase Auth Hook platform sends a Standard Webhooks-format signature
// (`webhook-id`, `webhook-timestamp`, `webhook-signature: v1,<base64-hmac>`) in the
// request headers, NOT the raw secret. Comparing the raw secret to a signature
// header can never match, which causes the platform to surface
// "Hook requires authorization token" on signup/recovery.
// @deno-types="https://esm.sh/standardwebhooks@1.0.0/dist/standardwebhooks.d.ts"
// eslint-disable-next-line @typescript-eslint/no-namespace, @typescript-eslint/triple-slash-reference
/// <reference path="https://esm.sh/standardwebhooks@1.0.0/dist/standardwebhooks.d.ts" />
import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0?target=denonext"
import { normalizeWebhookSecret } from "./webhook-secret.ts"

// ─── Brand tokens (mirrors BRAND.md) ──────────────────────────────────────
const BRAND = {
  primary: '#1e3a5f',
  primaryHover: '#14283f',
  accent: '#00d4ff',
  bg: '#f4f6fa',
  surface: '#ffffff',
  text: '#0a0e1a',
  muted: '#6b7280',
  border: '#e5e7eb',
  error: '#ef4444',
  success: '#10b981',
  gradientHero: 'linear-gradient(135deg, #0a0e1a 0%, #1e3a5f 100%)',
  gradientCta: 'linear-gradient(135deg, #1e3a5f 0%, #3b5f87 100%)',
  siteName: 'ReconIQ',
  siteShort: 'ReconIQ',
  tagline: 'Recon, exceptions, and agentic AI on one ledger of truth.',
  siteUrl: 'https://app.reconiq.example',
  supportEmail: 'support@reconiq.example',
  marketingSite: 'https://www.reconiq.example',
} as const

// ─── ZeptoMail HTTP client ────────────────────────────────────────────────
interface ZeptoMailAddress {
  name?: string
  email: string
}
interface ZeptoMailRequest {
  to: { email: string; name?: string }[]
  from: ZeptoMailAddress
  replyTo?: ZeptoMailAddress | undefined
  subject: string
  htmlBody: string
  textBody?: string
  clientReference?: string
  trackOpens?: boolean
  trackClicks?: boolean
}
interface ZeptoMailResponse {
  messageId?: string
  requestId?: string
}

async function sendViaZeptoMail(
  req: ZeptoMailRequest,
  opts: { apiToken: string; apiBase?: string },
): Promise<ZeptoMailResponse> {
  const base = opts.apiBase ?? 'https://api.zeptomail.in'
  const url = `${base.replace(/\/$/, '')}/v1.1/email`
  const body: Record<string, unknown> = {
    from: { address: req.from.email, name: req.from.name },
    to: req.to.map((r) => ({ email_address: { address: r.email, name: r.name } })),
    reply_to: req.replyTo
      ? { address: req.replyTo.email, name: req.replyTo.name }
      : undefined,
    subject: req.subject,
    htmlbody: req.htmlBody,
    textbody: req.textBody ?? '',
    client_reference: req.clientReference ?? '',
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: opts.apiToken,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let parsed: unknown = text
  try {
    parsed = JSON.parse(text)
  } catch {
    /* not JSON; keep raw text */
  }
  if (!res.ok) {
    const err: any = new Error('ZeptoMail rejected the request (HTTP ' + res.status + ')')
    err.name = 'ZeptoMailHttpError'
    err.code = 'HTTP_' + res.status
    err.status = res.status
    err.body = parsed
    throw err
  }
  const obj = (parsed && typeof parsed === 'object' ? parsed : {}) as {
    data?: { message_id?: string; request_id?: string }
  }
  return {
    messageId: obj.data?.message_id,
    requestId: obj.data?.request_id,
  }
}

// ─── HTML chrome (shared shell + utility styles) ────────────────────────
function escapeHtml(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      default:
        return '&#39;'
    }
  })
}

/** Owner-approved raster master; adjacent brand text remains if mail clients block remote images. */
const APPROVED_LOGO_URL = `${BRAND.siteUrl}/rq-seal.svg`

type EmailStep = { title: string; detail: string }

function renderSteps(steps: EmailStep[]): string {
  if (steps.length === 0) return ''
  const cells = steps
    .map(
      (step, index) => `<td class="fvi-step-cell" width="33.33%" valign="top" align="center" style="padding:0 8px 8px 8px;">
        <span class="fvi-step-number" style="display:inline-block;width:30px;height:30px;border-radius:30px;background:#e7f8fa;border:1px solid #a9dfe4;color:#087f8b;font:700 13px/30px Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;text-align:center;">${index + 1}</span>
        <p class="fvi-copy" style="margin:10px 0 3px 0;color:#10213a;font:700 13px/1.35 Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${escapeHtml(step.title)}</p>
        <p class="fvi-muted" style="margin:0;color:#59677a;font:400 12px/1.45 Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${escapeHtml(step.detail)}</p>
      </td>`,
    )
    .join('')
  return `<tr><td class="fvi-pad" style="padding:12px 40px 22px 40px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
      <td width="34%" style="border-top:1px solid #d8dee8;font-size:1px;line-height:1px;">&nbsp;</td>
      <td class="fvi-muted" align="center" style="padding:0 12px;color:#59677a;font:700 10px/1 Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;letter-spacing:.16em;white-space:nowrap;">WHAT HAPPENS NEXT</td>
      <td width="34%" style="border-top:1px solid #d8dee8;font-size:1px;line-height:1px;">&nbsp;</td>
    </tr></table>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:20px;"><tr>${cells}</tr></table>
  </td></tr>`
}

/** Shared dual-theme shell selected by the owner on 2026-09-02. */
function renderShell(opts: {
  eyebrow: string
  title: string
  recipient: string
  body: string
  ctaText?: string
  ctaUrl?: string
  expiry?: string
  steps?: EmailStep[]
  securityNote?: string
  footerNote?: string
}): string {
  const safeEyebrow = escapeHtml(opts.eyebrow)
  const safeTitle = escapeHtml(opts.title)
  const safeRecipient = escapeHtml(opts.recipient || 'there')
  const safeCtaText = opts.ctaText ? escapeHtml(opts.ctaText) : ''
  const safeCtaUrl = opts.ctaUrl ? escapeHtml(opts.ctaUrl) : ''
  const safeExpiry = opts.expiry ? escapeHtml(opts.expiry) : ''
  const safeSecurity = escapeHtml(
    opts.securityNote ??
      'This link is unique to your account and expires automatically. ReconIQ will never ask for this link, your password, or a verification code.',
  )
  const safeFooterNote = opts.footerNote ? escapeHtml(opts.footerNote) : ''
  const ctaBlock = opts.ctaText && opts.ctaUrl
    ? `<tr><td class="fvi-pad" align="center" style="padding:20px 40px 16px 40px;">
        <a class="fvi-button" href="${safeCtaUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;min-width:210px;background:#0b2545;color:#ffffff;text-decoration:none;font:700 15px/1 Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:16px 28px;border-radius:8px;text-align:center;">${safeCtaText}</a>
      </td></tr>`
    : ''
  const fallbackBlock = opts.ctaUrl
    ? `<tr><td class="fvi-pad" style="padding:0 40px 18px 40px;">
        <table class="fvi-fallback" role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#fbf7ef;border:1px solid #eadfc9;border-radius:8px;">
          <tr><td style="padding:14px 16px;">
            <p class="fvi-copy" style="margin:0 0 4px 0;color:#10213a;font:700 12px/1.4 Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">Can’t use the button?</p>
            <p class="fvi-muted" style="margin:0 0 6px 0;color:#59677a;font:400 12px/1.4 Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">Copy and paste this secure link into your browser:</p>
            <p class="fvi-link" style="margin:0;word-break:break-all;color:#0b5d87;font:400 11px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;">${safeCtaUrl}</p>
          </td></tr>
        </table>
      </td></tr>`
    : ''
  const html = `<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${safeTitle}</title>
<style>
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  @media only screen and (max-width:620px) {
    .fvi-card { width:100% !important; border-radius:0 !important; }
    .fvi-pad { padding-left:24px !important; padding-right:24px !important; }
    .fvi-header-copy { padding-left:14px !important; }
    .fvi-step-cell { display:block !important; width:100% !important; padding:0 0 16px 0 !important; }
    .fvi-title { font-size:28px !important; }
  }
  @media (prefers-color-scheme: dark) {
    body, .fvi-page { background:#071421 !important; }
    .fvi-card, .fvi-header, .fvi-body, .fvi-support { background:#0b2238 !important; }
    .fvi-utility { background:#06172a !important; }
    .fvi-wordmark, .fvi-title, .fvi-copy { color:#f7f3ea !important; }
    .fvi-muted { color:#b8c4d3 !important; }
    .fvi-button { background:#12a9b6 !important; color:#ffffff !important; }
    .fvi-security { background:#0e3447 !important; border-color:#246174 !important; }
    .fvi-fallback { background:#122c43 !important; border-color:#405268 !important; }
    .fvi-footer { background:#081b2e !important; border-color:#c59b45 !important; }
    .fvi-step-number { background:#0d3a4a !important; border-color:#278595 !important; color:#55d3dd !important; }
    .fvi-link { color:#55d3dd !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#f3f6fa;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#10213a;-webkit-font-smoothing:antialiased;">
<table class="fvi-page" role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f3f6fa;padding:24px 12px;">
<tr><td align="center">
<table class="fvi-card" role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;box-shadow:0 10px 36px rgba(11,37,69,.10);overflow:hidden;">
  <tr><td class="fvi-utility" style="background:#081d35;padding:9px 32px;color:#ffffff;font:600 10px/1.3 Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;letter-spacing:.08em;text-transform:uppercase;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
      <td style="color:#ffffff;">Secure message</td>
      <td align="right" style="color:#dce6f1;">${safeExpiry || 'Protected communication'}</td>
    </tr></table>
  </td></tr>
  <tr><td class="fvi-header fvi-pad" style="background:#ffffff;padding:24px 32px;border-bottom:2px solid #c59b45;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
      <td width="82" valign="middle" style="padding:8px;background:#ffffff;border-radius:6px;">
        <img src="${APPROVED_LOGO_URL}" width="82" height="82" alt="ReconIQ aperture and wing symbol with ReconIQ wordmark" style="display:block;width:82px;height:82px;border:0;outline:none;text-decoration:none;" />
      </td>
      <td class="fvi-header-copy" valign="middle" style="padding-left:18px;">
        <p class="fvi-wordmark" style="margin:0;color:#0b2545;font:700 17px/1.2 Georgia,'Times New Roman',serif;letter-spacing:.13em;text-transform:uppercase;">ReconIQ</p>
        <p class="fvi-muted" style="margin:6px 0 0 0;color:#59677a;font:500 9px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.11em;text-transform:uppercase;">${escapeHtml(BRAND.tagline)}</p>
      </td>
    </tr></table>
  </td></tr>
  <tr><td class="fvi-body fvi-pad" style="background:#ffffff;padding:30px 40px 0 40px;">
    <p style="margin:0 0 8px 0;color:#0793a0;font:700 10px/1.3 Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;letter-spacing:.14em;text-transform:uppercase;">${safeEyebrow}</p>
    <h1 class="fvi-title" style="margin:0 0 18px 0;color:#10213a;font:700 32px/1.16 Georgia,'Times New Roman',serif;letter-spacing:-.015em;">${safeTitle}</h1>
    <p class="fvi-copy" style="margin:0 0 12px 0;color:#10213a;font:400 14px/1.6 Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">Hello ${safeRecipient},</p>
    <div class="fvi-copy" style="color:#10213a;font:400 14px/1.6 Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${opts.body}</div>
    ${safeExpiry ? `<p class="fvi-copy" style="margin:16px 0 0 0;color:#10213a;font:600 13px/1.5 Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${safeExpiry}</p>` : ''}
  </td></tr>
  ${ctaBlock}
  ${renderSteps(opts.steps ?? [])}
  <tr><td class="fvi-pad" style="padding:0 40px 14px 40px;">
    <table class="fvi-security" role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#ecf9fb;border:1px solid #b9e5e9;border-radius:8px;">
      <tr><td style="padding:14px 16px;">
        <p style="margin:0 0 3px 0;color:#087f8b;font:700 12px/1.4 Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">Security notice</p>
        <p class="fvi-muted" style="margin:0;color:#43566c;font:400 12px/1.5 Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${safeSecurity}</p>
      </td></tr>
    </table>
  </td></tr>
  ${fallbackBlock}
  ${safeFooterNote ? `<tr><td class="fvi-body fvi-pad" style="padding:0 40px 18px 40px;background:#ffffff;"><p class="fvi-muted" style="margin:0;color:#59677a;font:400 12px/1.5 Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${safeFooterNote}</p></td></tr>` : ''}
  <tr><td class="fvi-support fvi-pad" style="background:#ffffff;padding:14px 40px 22px 40px;border-top:1px solid #d8dee8;">
    <p class="fvi-copy" style="margin:0 0 3px 0;color:#10213a;font:700 12px/1.4 Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">Need help?</p>
    <p class="fvi-muted" style="margin:0;color:#59677a;font:400 12px/1.5 Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">Contact our support team at <a class="fvi-link" href="mailto:${BRAND.supportEmail}" style="color:#0b5d87;text-decoration:underline;">${BRAND.supportEmail}</a></p>
  </td></tr>
  <tr><td class="fvi-footer fvi-pad" style="background:#fbfaf7;padding:20px 40px 24px 40px;text-align:center;border-top:2px solid #c59b45;">
    <p class="fvi-copy" style="margin:0;color:#10213a;font:600 13px/1.4 Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${BRAND.siteName}</p>
    <p class="fvi-muted" style="margin:8px 0 0 0;color:#59677a;font:400 11px/1.5 Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">Secure transmission &nbsp;•&nbsp; Bank-grade encryption &nbsp;•&nbsp; Privacy by design</p>
    <p class="fvi-muted" style="margin:8px 0 0 0;color:#7a8695;font:400 10px/1.5 Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">© ${new Date().getUTCFullYear()} ReconIQ. All rights reserved.</p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`
  return html.replace(/^[\t ]+$/gmu, '')
}

/** Subjects per action (centralized). */
const SUBJECTS: Record<string, (recipient: string) => string> = {
  signup: () => 'Confirm your ReconIQ account',
  recovery: () => 'Your ReconIQ sign-in link',
  magic_link: () => 'Your one-time sign-in link — ReconIQ',
  login: () => 'Your one-time sign-in link — ReconIQ',
  email_change: (r: string) => 'Confirm your new ReconIQ email',
  email_change_confirm: (r: string) => 'Confirm your new ReconIQ email',
  invite: () => "You're invited to ReconIQ",
  reauthentication: () => 'Verify it’s you — ReconIQ',
  password_changed_notification: () => 'Your ReconIQ password was changed',
}

export interface SupabaseEmailHookPayload {
  user: {
    id: string
    email?: string
    new_email?: string
    old_email?: string
    email_change?: string
    user_metadata?: Record<string, unknown>
  }
  email_data?: {
    site_url?: string
    token?: string
    token_hash?: string
    redirect_to?: string
    token_new?: string
    token_hash_new?: string
    redirect_to_new?: string
    token_current?: string
    token_hash_current?: string
    redirect_to_current?: string
    email_action_type?: string
  }
  email_action_type?: string
  confirmation_url?: string
}

interface RenderedEmail {
  subject: string
  html: string
  text: string
}

interface RenderOptions {
  confirmationUrl?: string
}

export interface AuthEmailDelivery {
  recipient: string
  confirmationUrl: string
}

const LINK_REQUIRED_ACTIONS = new Set([
  'signup',
  'recovery',
  'magic_link',
  'login',
  'email_change',
  'email_change_confirm',
  'invite',
])

function verificationType(action: string): string {
  if (action === 'magic_link' || action === 'login') return 'magiclink'
  if (action === 'email_change_confirm') return 'email_change'
  return action
}

/**
 * Build an ReconIQ confirmation-interstitial URL from the hook payload. The
 * interstitial verifies through Supabase's POST API only after a user action,
 * preventing mail-security scanners from consuming a single-use GET link.
 */
export function buildConfirmationUrl(
  payload: SupabaseEmailHookPayload,
  supabaseUrl: string,
  overrides: { tokenHash?: string; redirectTo?: string; action?: string } = {},
): string {
  if (payload.confirmation_url && !overrides.tokenHash) return payload.confirmation_url

  const action = overrides.action ?? payload.email_action_type ?? payload.email_data?.email_action_type ?? 'signup'
  const tokenHash = overrides.tokenHash ?? payload.email_data?.token_hash
  const redirectTo = overrides.redirectTo ?? payload.email_data?.redirect_to
  const baseUrl = redirectTo || payload.email_data?.site_url || supabaseUrl
  if (!baseUrl || !tokenHash) return ''

  const url = new URL('/confirm-auth', baseUrl)
  url.searchParams.set('token_hash', tokenHash)
  url.searchParams.set('type', verificationType(action))
  if (redirectTo) url.searchParams.set('redirect_to', redirectTo)
  return url.toString()
}

/** Resolve recipient/link pairs, including Supabase secure email-change semantics. */
export function resolveAuthEmailDeliveries(
  payload: SupabaseEmailHookPayload,
  supabaseUrl: string,
): AuthEmailDelivery[] {
  const action = payload.email_action_type ?? payload.email_data?.email_action_type ?? 'signup'
  const currentEmail = payload.user?.email
  const newEmail = payload.user?.new_email

  // Security notifications always go to the currently authenticated address.
  // Never fall back to an unverified new_email supplied during an email change.
  if (action === 'password_changed_notification') {
    return currentEmail ? [{ recipient: currentEmail, confirmationUrl: '' }] : []
  }

  if (action === 'email_change' && currentEmail && newEmail) {
    const deliveries: AuthEmailDelivery[] = []
    // Supabase intentionally reverses the secure-change hash field names.
    const currentUrl = buildConfirmationUrl(payload, supabaseUrl, {
      tokenHash: payload.email_data?.token_hash_new,
      redirectTo: payload.email_data?.redirect_to_current ?? payload.email_data?.redirect_to,
      action,
    })
    const newUrl = buildConfirmationUrl(payload, supabaseUrl, {
      tokenHash: payload.email_data?.token_hash,
      redirectTo: payload.email_data?.redirect_to_new ?? payload.email_data?.redirect_to,
      action,
    })
    if (currentUrl) deliveries.push({ recipient: currentEmail, confirmationUrl: currentUrl })
    if (newUrl) deliveries.push({ recipient: newEmail, confirmationUrl: newUrl })
    return deliveries
  }

  const recipient = currentEmail ?? newEmail
  if (!recipient) return []
  return [{ recipient, confirmationUrl: buildConfirmationUrl(payload, supabaseUrl) }]
}

export function renderAuthEmail(payload: SupabaseEmailHookPayload, options: RenderOptions = {}): RenderedEmail {
  const action = payload.email_action_type ?? payload.email_data?.email_action_type ?? 'signup'
  const confirmUrl = options.confirmationUrl ?? payload.confirmation_url ?? ''
  if (LINK_REQUIRED_ACTIONS.has(action) && !confirmUrl) {
    throw new Error(`confirmation link unavailable for ${action} email`)
  }
  const metadataName = payload.user?.user_metadata?.full_name ?? payload.user?.user_metadata?.name
  const recipient =
    typeof metadataName === 'string' && metadataName.trim()
      ? metadataName.trim().split(/\s+/u)[0]
      : 'there'
  const subjectFn = SUBJECTS[action] ?? (() => 'ReconIQ notification')
  const subject = subjectFn(recipient)

  switch (action) {
    case 'signup':
    case 'email_change_confirm': {
      const newEmail = payload.user?.new_email ?? ''
      const body = `
        <p style="margin:0;">
          Welcome to <strong style="color:${BRAND.primary};">ReconIQ</strong>. Please confirm your email${newEmail ? ' (' + escapeHtml(newEmail) + ')' : ''} to finish setting up your workspace.
        </p>
        <p style="margin:12px 0 0 0;">If you didn’t request this, you can safely ignore this email.</p>`
      return {
        subject,
        html: renderShell({
          eyebrow: 'Account verification',
          title: 'Confirm your email to activate your workspace',
          recipient,
          body,
          ctaText: 'Confirm email →',
          ctaUrl: confirmUrl,
          expiry: 'This secure link expires in 24 hours.',
          steps: [
            { title: 'Review invitation', detail: 'Confirm the organization and email address.' },
            { title: 'Confirm email', detail: 'Open the protected verification page.' },
            { title: 'Sign in', detail: 'Return to ReconIQ with your verified account.' },
          ],
          footerNote:
            'After confirmation you’ll be able to sign in at ' + BRAND.siteUrl,
        }),
        text:
          'Hi ' +
          recipient +
          '\n\nWelcome to ReconIQ. Please confirm your email by visiting:\n\n' +
          confirmUrl +
          '\n\nThis link expires in 24 hours. If you didn’t request this, you can safely ignore this email.',
      }
    }
    case 'recovery':
    case 'magic_link':
    case 'login': {
      const isRecovery = action === 'recovery'
      const body = `
        <p style="margin:0;">
          Use the button below to ${isRecovery ? 'reset your password and sign back in' : 'sign in to ReconIQ'}.
          The link is single-use and stops working after the action completes.
        </p>`
      return {
        subject,
        html: renderShell({
          eyebrow: isRecovery ? 'Password recovery' : 'One-time sign-in',
          title: isRecovery
            ? 'Reset your password'
            : 'Your secure ReconIQ sign-in',
          recipient,
          body,
          ctaText: isRecovery ? 'Reset password' : 'Sign in',
          ctaUrl: confirmUrl,
          expiry: 'This secure link expires in 60 minutes.',
          steps: isRecovery
            ? [
                { title: 'Open secure link', detail: 'Use the protected button above.' },
                { title: 'Choose new password', detail: 'Create a strong password you have not used before.' },
                { title: 'Return to ReconIQ', detail: 'Sign in with your new password.' },
              ]
            : [
                { title: 'Open secure link', detail: 'Use the protected button above.' },
                { title: 'Verify this device', detail: 'Complete the one-time check.' },
                { title: 'Return to ReconIQ', detail: 'Continue securely to your workspace.' },
              ],
          footerNote:
            'If you didn’t request this, you can safely ignore this email. Your account is still secure.',
        }),
        text:
          'Hi ' +
          recipient +
          '\n\nUse this link to ' +
          (isRecovery ? 'reset your password' : 'sign in') +
          ' to ReconIQ:\n\n' +
          confirmUrl +
          '\n\nThis link expires in 1 hour. If you didn’t request this, you can safely ignore this email.',
      }
    }
    case 'email_change': {
      const newEmail = payload.user?.new_email ?? recipient
      const oldEmail = payload.user?.email ?? 'your current address'
      const body = `
        <p style="margin:0;">
          A request was made to change your ReconIQ account email from
          <strong style="color:${BRAND.primary};">${escapeHtml(oldEmail)}</strong> to
          <strong style="color:${BRAND.primary};">${escapeHtml(newEmail)}</strong>.
        </p>
        <p style="margin:12px 0 0 0;"><strong style="color:${BRAND.error};">If you did not request this, do not continue.</strong> Change your password and contact support immediately.</p>`
      return {
        subject,
        html: renderShell({
          eyebrow: 'Email change',
          title: 'Confirm your new email address',
          recipient,
          body,
          ctaText: 'Confirm email change →',
          ctaUrl: confirmUrl,
          expiry: 'This secure link expires in 60 minutes.',
          steps: [
            { title: 'Review change', detail: 'Confirm both email addresses are correct.' },
            { title: 'Approve address', detail: 'Open the protected confirmation page.' },
            { title: 'Sign in again', detail: 'Return with your updated email address.' },
          ],
        }),
        text:
          'Hi ' +
          recipient +
          '\n\nYou requested to change your ReconIQ email to ' +
          newEmail +
          '. Confirm by visiting:\n\n' +
          confirmUrl +
          '\n\nIf you did not request this, secure your account immediately.',
      }
    }
    case 'invite': {
      const tenantName = 'your organization'
      const body = `
        <p style="margin:0;">
          You’ve been invited to join <strong style="color:${BRAND.primary};">${escapeHtml(tenantName)}</strong> on ReconIQ. Accept the invitation to create your account and get started.
        </p>`
      return {
        subject,
        html: renderShell({
          eyebrow: 'You’re invited',
          title: 'Join ' + escapeHtml(tenantName) + ' on ReconIQ',
          recipient,
          body,
          ctaText: 'Accept invitation',
          ctaUrl: confirmUrl,
          expiry: 'This invitation expires in 7 days.',
          steps: [
            { title: 'Review invitation', detail: 'Confirm the invitation is expected.' },
            { title: 'Set your password', detail: 'Create your enterprise sign-in credentials.' },
            { title: 'Open workspace', detail: 'Continue to your authorized ReconIQ tenant.' },
          ],
        }),
        text:
          'Hi\n\nYou’ve been invited to join ' +
          tenantName +
          ' on ReconIQ. Accept the invitation:\n\n' +
          confirmUrl +
          '\n\nThis link expires in 7 days.',
      }
    }
    case 'reauthentication': {
      const token = payload.email_data?.token ?? payload.email_data?.token_new ?? '------'
      const body = `
        <p style="margin:0;">
          We need to verify it’s really you before performing a sensitive action on your ReconIQ account. Enter this code in the prompt you saw on screen:
        </p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:20px 0 0 0;background:#0b2545;border-radius:8px;text-align:center;">
          <tr>
            <td align="center" style="padding:24px 16px;">
              <p style="margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:32px;font-weight:700;color:#ffffff;letter-spacing:0.35em;text-align:center;">${escapeHtml(token)}</p>
            </td>
          </tr>
        </table>
        <p style="margin:12px 0 0 0;">Enter the code only in the ReconIQ prompt you already opened.</p>`
      return {
        subject,
        html: renderShell({
          eyebrow: 'Step-up verification',
          title: 'Verify it’s you',
          recipient,
          body,
          expiry: 'This verification code expires in 5 minutes.',
          securityNote: 'Never share this code. ReconIQ support will never ask you to read it over the phone, email, or chat.',
        }),
        text:
          'Hi ' +
          recipient +
          '\n\nEnter this code in the prompt on screen: ' +
          token +
          '\n\nThis code expires in 5 minutes. If you didn’t request this, secure your account immediately.',
      }
    }
    case 'password_changed_notification': {
      const body = `
        <p style="margin:0;">The password for your ReconIQ account was changed.</p>
        <p style="margin:12px 0 0 0;">If you made this change, no further action is needed. If you did not, open ReconIQ by typing <strong>${escapeHtml(BRAND.siteUrl)}</strong> into your browser, reset your password, and contact support. Do not share your password or any verification code with anyone.</p>`
      return {
        subject,
        html: renderShell({
          eyebrow: 'Account security',
          title: 'Your password was changed',
          recipient,
          body,
          securityNote: 'This notice does not contain a sign-in link or password. If you did not make this change, secure your account using the official ReconIQ sign-in page.',
        }),
        text: `Hello ${recipient || 'there'},\n\nThe password for your ReconIQ account was changed. If you made this change, no further action is needed. If you did not, open ${BRAND.siteUrl} by typing the address into your browser, reset your password, and contact ${BRAND.supportEmail}. Do not share your password or any verification code with anyone.`,
      }
    }
    default: {
      const body = `<p style="margin:0;">
          You have a new ReconIQ notification.
        </p>`
      return {
        subject,
        html: renderShell({
          eyebrow: 'Notification',
          title: 'ReconIQ update',
          recipient,
          body,
          ctaText: 'View details →',
          ctaUrl: confirmUrl,
        }),
        text:
          'Hi ' +
          recipient +
          '\n\nYou have a new ReconIQ notification:\n\n' +
          confirmUrl,
      }
    }
  }
}

// ─── Edge Function entrypoint ────────────────────────────────────────────
async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })

  // LL-088 (2026-08-23): Verify the Standard Webhooks signature sent by the
  // Supabase Auth Hook platform. The platform sends a signed envelope
  // (`webhook-id`, `webhook-timestamp`, `webhook-signature` headers) keyed on
  // the dashboard's `hook_send_email_secrets` value. Verification MUST use the
  // `standardwebhooks@1.0.0` library — a naive header-compare will always 401
  // because no platform header carries the raw secret. Reading the raw payload
  // before calling `wh.verify()` is mandatory (the library signs the raw bytes,
  // not the parsed JSON).
  const hookSecret = Deno.env.get('HOOK_SECRET') ?? Deno.env.get('SEND_EMAIL_HOOK_SECRET')
  // LL-088: read the raw body once, then verify the Standard Webhooks signature.
  // If `hookSecret` is unset (dev only), verification is skipped but the body is
  // still consumed so JSON.parse below can succeed.
  const rawPayload = await req.text()
  if (hookSecret) {
    const headers: Record<string, string> = {}
    for (const [k, v] of req.headers.entries()) headers[k.toLowerCase()] = v
    try {
      // Supabase stores `v1,whsec_...`; standardwebhooks strips only `whsec_`.
      const wh = new Webhook(normalizeWebhookSecret(hookSecret))
      wh.verify(rawPayload, headers)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[send-email] webhook signature verification failed:', message)
      return jsonResponse({ error: 'unauthorized: invalid webhook signature' }, 401)
    }
  } else {
    console.warn('[send-email] HOOK_SECRET env not set — webhook auth disabled')
  }

  const zeptoToken = Deno.env.get('ZEPTO_MAIL_API_TOKEN')
  const fromHeader = Deno.env.get('FVI_EMAIL_FROM') ?? 'ReconIQ <noreply@reconintelligence.app>'
  const replyHeader = Deno.env.get('FVI_EMAIL_REPLY_TO')

  if (!zeptoToken) {
    return jsonResponse(
      { error: 'ZEPTO_MAIL_API_TOKEN not configured on the Edge Function' },
      500,
    )
  }

  let payload: SupabaseEmailHookPayload
  try {
    // LL-088: use the raw body captured for signature verification above — the
    // request stream can only be consumed once.
    payload = JSON.parse(rawPayload) as SupabaseEmailHookPayload
  } catch (e) {
    return jsonResponse({ error: 'Invalid JSON body', detail: String(e) }, 400)
  }

  const deliveries = resolveAuthEmailDeliveries(payload, Deno.env.get('SUPABASE_URL') ?? '')
  if (deliveries.length === 0) {
    return jsonResponse({ error: 'No recipient email in hook payload' }, 400)
  }

  const fromMatch = fromHeader.match(/^(.*?)\s*<([^>]+)>$/)
  const from = fromMatch
    ? { name: fromMatch[1].trim(), email: fromMatch[2].trim() }
    : { name: 'ReconIQ', email: fromHeader.trim() }
  const replyTo = replyHeader
    ? (() => {
        const m = replyHeader.match(/^(.*?)\s*<([^>]+)>$/)
        return m ? { name: m[1].trim(), email: m[2].trim() } : { name: 'ReconIQ Support', email: replyHeader.trim() }
      })()
    : undefined

  try {
    const results: ZeptoMailResponse[] = []
    for (const delivery of deliveries) {
      const rendered = renderAuthEmail(payload, { confirmationUrl: delivery.confirmationUrl })
      results.push(await sendViaZeptoMail(
        {
          to: [{ email: delivery.recipient }],
          from,
          replyTo,
          subject: rendered.subject,
          htmlBody: rendered.html,
          textBody: rendered.text,
          clientReference: 'fvi-auth-' + (payload.email_action_type ?? payload.email_data?.email_action_type ?? 'unknown') + '-' + payload.user.id + '-' + Date.now(),
        },
        { apiToken: zeptoToken },
      ))
    }
    return jsonResponse({ ok: true, deliveries: results.length, messageIds: results.map((r) => r.messageId).filter(Boolean) })
  } catch (e: any) {
    console.error('ZeptoMail send failed:', e)
    return jsonResponse(
      {
        error: 'zeptomail send failed',
        code: e.code,
        message: e.message,
        status: e.status,
        body: e.body,
      },
      500,
    )
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...corsHeaders(),
    },
  })
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey, webhook-secret',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}

// Deno entrypoint. Guarded so the renderer can be imported by proof tooling.
if (import.meta.main) Deno.serve(handle)

// Node/Workers entrypoint (for tests + Cloudflare Workers)
export default {
  async fetch(req: Request): Promise<Response> {
    return handle(req)
  },
}
