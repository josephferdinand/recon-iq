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

interface RecoveryEmailProps {
  siteName: string
  confirmationUrl: string
}

export const RecoveryEmail = ({
  siteName,
  confirmationUrl,
}: RecoveryEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Reset your password for {siteName}</Preview>
    <Body style={{ backgroundColor: BRAND.background, margin: 0, padding: 0 }}>
      <BrandShell preview={`Reset your ${siteName} password`}>
        <BrandEyebrow>Account security</BrandEyebrow>
        <BrandH1>Reset your password</BrandH1>
        <BrandP>
          We received a request to reset the password for your{' '}
          <strong>{siteName}</strong> account. If this was you, click the button
          below to choose a new password. The link expires in 1 hour.
        </BrandP>
        <BrandButton href={confirmationUrl}>Reset password</BrandButton>
        <BrandP>
          Or paste this link into your browser:
          <br />
          <BrandLink href={confirmationUrl}>{confirmationUrl}</BrandLink>
        </BrandP>
        <BrandMuted>
          Didn&rsquo;t request a reset? You can safely ignore this email &mdash;
          your password will remain unchanged. If you believe someone is trying
          to access your account, please contact{' '}
          <BrandLink href={`mailto:${BRAND.supportEmail}`}>
            {BRAND.supportEmail}
          </BrandLink>{' '}
          immediately.
        </BrandMuted>
      </BrandShell>
    </Body>
  </Html>
)

export default RecoveryEmail
