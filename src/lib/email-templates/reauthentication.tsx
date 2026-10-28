import * as React from 'react'

import {
  Body,
  Head,
  Html,
  Preview,
} from '@react-email/components'

import {
  BrandShell,
  BrandH1,
  BrandEyebrow,
  BrandP,
  BrandMuted,
  BRAND,
} from './brand-shell'

interface ReauthenticationEmailProps {
  token: string
}

export const ReauthenticationEmail = ({ token }: ReauthenticationEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your verification code</Preview>
    <Body style={{ backgroundColor: BRAND.background, margin: 0, padding: 0 }}>
      <BrandShell preview="Your reauthentication code">
        <BrandEyebrow>Reauthentication</BrandEyebrow>
        <BrandH1>Confirm it&rsquo;s you</BrandH1>

        <BrandP>
          We need to verify it&rsquo;s really you before completing a sensitive
          action. Enter the code below in the prompt you saw on screen:
        </BrandP>

        {/* Code block */}
        <table
          role="presentation"
          cellPadding={0}
          cellSpacing={0}
          border={0}
          width="100%"
          style={{
            backgroundColor: BRAND.textPrimary,
            backgroundImage: BRAND.heroGradient,
            borderRadius: 8,
            margin: '8px 0 20px',
          }}
        >
          <tbody>
            <tr>
              <td
                align="center"
                style={{
                  padding: '24px 16px',
                  fontFamily:
                    "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                  fontSize: 32,
                  fontWeight: 700,
                  color: BRAND.accent,
                  letterSpacing: '0.4em',
                  textAlign: 'center',
                }}
              >
                {token}
              </td>
            </tr>
          </tbody>
        </table>

        <BrandP>
          This code expires in 5 minutes. If you didn&rsquo;t initiate this
          request, you can safely ignore this email.
        </BrandP>
        <BrandMuted>
          If you didn&rsquo;t make this request, someone may be trying to access
          your account. Please change your password and review recent activity.
        </BrandMuted>
      </BrandShell>
    </Body>
  </Html>
)

export default ReauthenticationEmail