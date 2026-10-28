import * as React from 'react'

import {
  Body,
  Head,
  Html,
  Preview,
} from '@react-email/components'

import {
  BrandShell,
  BrandButton,
  BrandH1,
  BrandEyebrow,
  BrandP,
  BrandMuted,
  BrandLink,
  BRAND,
} from './brand-shell'

interface EmailChangeEmailProps {
  siteName: string
  // oldEmail is the user's current address (HookData.OldEmail). For the
  // NEW-recipient half of a secure email_change fanout, `email` equals the
  // recipient (NEW), so the "from" line must render oldEmail to read
  // "from OLD to NEW" instead of "from NEW to NEW".
  oldEmail: string
  email: string
  newEmail: string
  confirmationUrl: string
}

export const EmailChangeEmail = ({
  siteName,
  oldEmail,
  newEmail,
  confirmationUrl,
}: EmailChangeEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Confirm your email change for {siteName}</Preview>
    <Body style={{ backgroundColor: BRAND.background, margin: 0, padding: 0 }}>
      <BrandShell preview={`Confirm email change on ${siteName}`}>
        <BrandEyebrow>Email change</BrandEyebrow>
        <BrandH1>Confirm your email change</BrandH1>
        <BrandP>
          You requested to change the email address on your{' '}
          <strong>{siteName}</strong> account:
        </BrandP>
        <table
          role="presentation"
          cellPadding={0}
          cellSpacing={0}
          border={0}
          width="100%"
          style={{
            backgroundColor: '#f9fafb',
            border: `1px solid ${BRAND.border}`,
            borderRadius: 8,
            margin: '12px 0 20px',
          }}
        >
          <tbody>
            <tr>
              <td
                style={{
                  padding: '14px 18px',
                  fontSize: 14,
                  color: BRAND.textMuted,
                  fontFamily:
                    "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                  lineHeight: 1.6,
                }}
              >
                <div>
                  <span style={{ color: BRAND.textMuted, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    From
                  </span>
                  <br />
                  <span style={{ color: BRAND.textPrimary, fontSize: 14, textDecoration: 'line-through' }}>
                    {oldEmail}
                  </span>
                </div>
                <div style={{ marginTop: 12 }}>
                  <span style={{ color: BRAND.textMuted, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    To
                  </span>
                  <br />
                  <span style={{ color: BRAND.primary, fontSize: 14, fontWeight: 600 }}>
                    {newEmail}
                  </span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <BrandP>
          Click the button below to confirm this change. Both the old and new
          addresses must approve before the change takes effect.
        </BrandP>
        <BrandButton href={confirmationUrl}>Confirm email change</BrandButton>
        <BrandP>
          Or paste this link into your browser:
          <br />
          <BrandLink href={confirmationUrl}>{confirmationUrl}</BrandLink>
        </BrandP>
        <BrandMuted>
          Didn&rsquo;t request this change?{' '}
          <strong style={{ color: BRAND.textPrimary }}>
            Your account may be compromised.
          </strong>{' '}
          Please contact{' '}
          <BrandLink href={`mailto:${BRAND.supportEmail}`}>
            {BRAND.supportEmail}
          </BrandLink>{' '}
          immediately and reset your password.
        </BrandMuted>
      </BrandShell>
    </Body>
  </Html>
)

export default EmailChangeEmail