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

interface InviteEmailProps {
  siteName: string
  siteUrl: string
  confirmationUrl: string
  inviterName?: string
  tenantName?: string
}

export const InviteEmail = ({
  siteName,
  siteUrl,
  confirmationUrl,
  inviterName,
  tenantName,
}: InviteEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>
      You&rsquo;ve been invited to join {tenantName ?? siteName}
    </Preview>
    <Body style={{ backgroundColor: BRAND.background, margin: 0, padding: 0 }}>
      <BrandShell
        preview={`Invitation to join ${tenantName ?? siteName} on ${siteName}`}
      >
        <BrandEyebrow>Tenant invitation</BrandEyebrow>
        <BrandH1>You&rsquo;re invited</BrandH1>
        <BrandP>
          {inviterName ? (
            <>
              <strong>{inviterName}</strong> has invited you to join{' '}
              <strong>{tenantName ?? siteName}</strong> on{' '}
              <strong>{siteName}</strong>.
            </>
          ) : (
            <>
              You&rsquo;ve been invited to join{' '}
              <strong>{tenantName ?? siteName}</strong> on{' '}
              <strong>{siteName}</strong>.
            </>
          )}{' '}
          Click the button below to accept the invitation and create your
          account.
        </BrandP>
        <BrandButton href={confirmationUrl}>Accept invitation</BrandButton>
        <BrandP>
          Or paste this link into your browser:
          <br />
          <BrandLink href={confirmationUrl}>{confirmationUrl}</BrandLink>
        </BrandP>
        <BrandMuted>
          Weren&rsquo;t expecting this invitation? You can safely ignore this
          email &mdash; no account will be created unless you accept.
          <br />
          <br />
          Accepting from{' '}
          <BrandLink href={siteUrl}>
            {siteUrl.replace(/^https?:\/\//, '')}
          </BrandLink>
        </BrandMuted>
      </BrandShell>
    </Body>
  </Html>
)

export default InviteEmail
