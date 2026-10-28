import * as React from 'react'

import { Body, Head, Html, Preview } from '@react-email/components'

import {
  BrandShell,
  BrandH1,
  BrandEyebrow,
  BrandP,
  BrandMuted,
  BRAND,
} from './brand-shell'

/** A notice only; deliberately contains no password, token, or recovery link. */
export const PasswordChangedEmail = () => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your ReconIQ password was changed</Preview>
    <Body style={{ backgroundColor: BRAND.background, margin: 0, padding: 0 }}>
      <BrandShell preview="Your ReconIQ password was changed">
        <BrandEyebrow>Account security</BrandEyebrow>
        <BrandH1>Your password was changed</BrandH1>
        <BrandP>
          The password for your <strong>{BRAND.siteName}</strong> account was changed. If you made
          this change, no further action is needed.
        </BrandP>
        <BrandMuted>
          If you did not make this change, open the official ReconIQ sign-in page by typing{' '}
          {BRAND.accountSite} into your browser, reset your password, and contact {BRAND.supportEmail}.
          Do not share your password or any verification code with anyone.
        </BrandMuted>
      </BrandShell>
    </Body>
  </Html>
)

export default PasswordChangedEmail
