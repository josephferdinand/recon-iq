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

interface MagicLinkEmailProps {
  siteName: string
  confirmationUrl: string
}

export const MagicLinkEmail = ({
  siteName,
  confirmationUrl,
}: MagicLinkEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your login link for {siteName}</Preview>
    <Body style={{ backgroundColor: BRAND.background, margin: 0, padding: 0 }}>
      <BrandShell preview={`Your secure login link for ${siteName}`}>
        <BrandEyebrow>One-time login</BrandEyebrow>
        <BrandH1>Your login link</BrandH1>
        <BrandP>
          Click the button below to sign in to <strong>{siteName}</strong>. This
          link expires in 60 minutes and can only be used once.
        </BrandP>
        <BrandButton href={confirmationUrl}>Log in</BrandButton>
        <BrandP>
          Or paste this link into your browser:
          <br />
          <BrandLink href={confirmationUrl}>{confirmationUrl}</BrandLink>
        </BrandP>
        <BrandMuted>
          Didn&rsquo;t request this link? You can safely ignore this email &mdash;
          no one will be able to sign in without clicking it.
          <br />
          <br />
          For your security, this link is tied to the device and browser that
          initiated the request. If you opened this email on a different device,
          you may need to start the sign-in flow again from that device.
        </BrandMuted>
      </BrandShell>
    </Body>
  </Html>
)

export default MagicLinkEmail
