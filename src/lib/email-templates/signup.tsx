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

interface SignupEmailProps {
  siteName: string
  siteUrl: string
  recipient: string
  confirmationUrl: string
}

export const SignupEmail = ({
  siteName,
  confirmationUrl,
  recipient,
  siteUrl,
}: SignupEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Confirm your email for {siteName}</Preview>
    <Body style={{ backgroundColor: BRAND.background, margin: 0, padding: 0 }}>
      <BrandShell preview={`Welcome to ${siteName} — confirm your email to get started`}>
        <BrandEyebrow>Account verification</BrandEyebrow>
        <BrandH1>Confirm your email</BrandH1>
        <BrandP>
          Thanks for signing up for {siteName}. We need to confirm that{' '}
          <strong>{recipient}</strong> is yours before activating your workspace.
        </BrandP>
        <BrandP>
          Click the button below to verify your email and finish setting up your
          account. The link expires in 24 hours.
        </BrandP>
        <BrandButton href={confirmationUrl}>Verify email</BrandButton>
        <BrandP>
          Or paste this link into your browser:
          <br />
          <BrandLink href={confirmationUrl}>{confirmationUrl}</BrandLink>
        </BrandP>
        <BrandMuted>
          Didn&rsquo;t create an account? You can safely ignore this email &mdash; no
          account will be created until you confirm.
          <br />
          <br />
          Working from{' '}
          <BrandLink href={siteUrl}>{siteUrl.replace(/^https?:\/\//, '')}</BrandLink>
        </BrandMuted>
      </BrandShell>
    </Body>
  </Html>
)

export default SignupEmail
