/**
 * ReconIQ auth email renderer.
 *
 * Renders one of the ReconIQ React Email templates to a complete HTML document
 * (with the matching plain-text fallback) for the given Supabase Auth Hook
 * event payload.
 *
 * This module is the SINGLE bridge between Supabase's auth flow and ReconIQ's
 * branded templates. The Auth Hook Edge Function calls `renderAuthEmail()`
 * and ships the result through ZeptoMail.
 *
 * See: https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook
 * See: BRAND.md for the ReconIQ visual identity.
 */

import { render } from '@react-email/render'

import { SignupEmail } from './signup'
import { RecoveryEmail } from './recovery'
import { MagicLinkEmail } from './magic-link'
import { InviteEmail } from './invite'
import { EmailChangeEmail } from './email-change'
import { ReauthenticationEmail } from './reauthentication'
import { PasswordChangedEmail } from './password-changed'

/** Subset of Supabase Send-Email Hook payload we care about. */
export interface AuthHookUser {
  id: string
  email?: string
  new_email?: string
  email_change?: string
  old_email?: string
}

export interface AuthHookPayload {
  /** Supabase user object. */
  user: AuthHookUser
  /** New email (for email_change_current and email_change_new). */
  email_data?: {
    token_new?: string
    token_hash_new?: string
    redirect_to_new?: string
    token?: string
    token_hash?: string
    redirect_to?: string
    email_action_type?: AuthEmailActionType
    site_url?: string
    token_current?: string
    token_hash_current?: string
    redirect_to_current?: string
  }
  /** Email action type. Supabase Auth Hook sets this. */
  email_action_type?: AuthEmailActionType
  /** Pre-built confirmation URL (Supabase-provided). */
  confirmation_url?: string
}

/** Values that Supabase's send-email hook populates for `email_action_type`. */
export type AuthEmailActionType =
  | 'signup'
  | 'login'
  | 'magic_link'
  | 'recovery'
  | 'invite'
  | 'email_change_current'
  | 'email_change_new'
  | 'email_change'
  | 'reauthentication'
  | 'password_changed_notification'

export interface RenderedAuthEmail {
  subject: string
  html: string
  text: string
}

const SITE_NAME = 'ReconIQ'
const SITE_URL = process.env.VITE_PUBLIC_APP_URL ?? 'https://reconintelligence.app'

/**
 * Render the appropriate ReconIQ template for a given Supabase auth event.
 * Returns { subject, html, text } ready to ship through ZeptoMail.
 */
export async function renderAuthEmail(payload: AuthHookPayload): Promise<RenderedAuthEmail> {
  const action = (payload.email_action_type ??
    payload.email_data?.email_action_type ??
    'signup') as AuthEmailActionType

  const confirmationUrl =
    payload.confirmation_url ??
    payload.email_data?.redirect_to ??
    '#'

  const recipient = payload.user.email ?? payload.user.new_email ?? ''
  const oldEmail = payload.user.old_email ?? payload.user.email ?? ''
  const newEmail = payload.user.new_email ?? payload.user.email_change ?? recipient

  switch (action) {
    case 'signup': {
      const element = (
        <SignupEmail
          siteName={SITE_NAME}
          siteUrl={SITE_URL}
          recipient={recipient}
          confirmationUrl={confirmationUrl}
        />
      )
      return {
        subject: `Confirm your ${SITE_NAME} email`,
        html: await render(element),
        text: await render(element, { plainText: true }),
      }
    }

    case 'recovery': {
      const element = (
        <RecoveryEmail
          siteName={SITE_NAME}
          confirmationUrl={confirmationUrl}
        />
      )
      return {
        subject: `Reset your ${SITE_NAME} password`,
        html: await render(element),
        text: await render(element, { plainText: true }),
      }
    }

    case 'magic_link':
    case 'login': {
      const element = (
        <MagicLinkEmail
          siteName={SITE_NAME}
          confirmationUrl={confirmationUrl}
        />
      )
      return {
        subject: `Your ${SITE_NAME} login link`,
        html: await render(element),
        text: await render(element, { plainText: true }),
      }
    }

    case 'invite': {
      const element = (
        <InviteEmail
          siteName={SITE_NAME}
          siteUrl={SITE_URL}
          confirmationUrl={confirmationUrl}
        />
      )
      return {
        subject: `You've been invited to ${SITE_NAME}`,
        html: await render(element),
        text: await render(element, { plainText: true }),
      }
    }

    case 'email_change':
    case 'email_change_current':
    case 'email_change_new': {
      const element = (
        <EmailChangeEmail
          siteName={SITE_NAME}
          oldEmail={oldEmail}
          email={recipient}
          newEmail={newEmail}
          confirmationUrl={confirmationUrl}
        />
      )
      return {
        subject: `Confirm your ${SITE_NAME} email change`,
        html: await render(element),
        text: await render(element, { plainText: true }),
      }
    }

    case 'reauthentication': {
      const token =
        payload.email_data?.token ??
        payload.email_data?.token_new ??
        '------'
      const element = <ReauthenticationEmail token={token} />
      return {
        subject: `Your ${SITE_NAME} verification code`,
        html: await render(element),
        text: await render(element, { plainText: true }),
      }
    }

    case 'password_changed_notification': {
      const element = <PasswordChangedEmail />
      return {
        subject: `Your ${SITE_NAME} password was changed`,
        html: await render(element),
        text: await render(element, { plainText: true }),
      }
    }

    default: {
      // Fallback to signup template to ensure something branded goes out
      const element = (
        <SignupEmail
          siteName={SITE_NAME}
          siteUrl={SITE_URL}
          recipient={recipient}
          confirmationUrl={confirmationUrl}
        />
      )
      return {
        subject: `Action required on your ${SITE_NAME} account`,
        html: await render(element),
        text: await render(element, { plainText: true }),
      }
    }
  }
}
