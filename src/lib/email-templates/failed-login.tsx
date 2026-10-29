import * as React from "react";
import { render } from "@react-email/render";
import { Html, Head, Body } from "@react-email/components";
import { BrandEyebrow, BrandH1, BrandP, BrandButton, BrandLink, BrandMuted, BRAND } from "./brand-shell";
import { canonicalFailedLoginOrigin, failedLoginDescriptions, type FailedLoginOutcome } from "../failed-login-notifications";

export async function renderFailedLoginEmail(input: { attemptId: string; requestId?: string; occurredAt: string; outcome: FailedLoginOutcome; origin: string }) {
  const origin = canonicalFailedLoginOrigin(input.origin);
  if (!/^[0-9a-f-]{36}$/i.test(input.attemptId) || (input.requestId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId)) || !Number.isFinite(Date.parse(input.occurredAt)) || !failedLoginDescriptions[input.outcome]) {
    throw new Error("Failed-login email event invalid");
  }
  const time = new Date(input.occurredAt).toISOString();
  const subject = "Security notice: a sign-in attempt failed";
  const element = <Html lang="en"><Head /><Body style={{ backgroundColor: BRAND.background, margin: 0 }}>
    <div style={{ display: "none", maxHeight: 0, overflow: "hidden" }}>{subject}</div>
    <table role="presentation" width="100%" cellPadding={0} cellSpacing={0}><tbody><tr><td style={{ padding: "32px 16px" }}>
    <table role="presentation" width="600" cellPadding={0} cellSpacing={0} style={{ maxWidth: 600, width: "100%", margin: "0 auto", backgroundColor: BRAND.surface }}><tbody>
      <tr><td style={{ padding: "28px 32px", backgroundColor: BRAND.primary, borderRadius: "12px 12px 0 0" }}>
        <img src={`${origin}/rq-seal.svg`} width="128" height="128" alt="ReconIQ monogram" style={{ display: "block", border: 0 }} />
        <p style={{ color: BRAND.textInverse, fontSize: 18, fontWeight: 700 }}>ReconIQ</p>
      </td></tr>
      <tr><td style={{ padding: "40px 32px", color: BRAND.textPrimary, fontFamily: "Inter, Arial, sans-serif", lineHeight: 1.6 }}>
      <BrandEyebrow>Account security</BrandEyebrow><BrandH1>A sign-in attempt failed</BrandH1>
      <BrandP>A sign-in attempt for your ReconIQ account did not complete at <strong>{time} (UTC)</strong>.</BrandP>
      <BrandP>{failedLoginDescriptions[input.outcome]}</BrandP>
      <BrandP>If this was you, try signing in again. If you do not recognize the attempt, use Forgot Password to request a secure recovery link and contact your administrator.</BrandP>
      <BrandButton href={`${origin}/auth`}>Sign in</BrandButton>
      <BrandP><BrandLink href={`${origin}/auth?reset=true`}>Forgot Password</BrandLink></BrandP>
      <BrandMuted>This notice does not change your password or end your existing sessions. Reference: {input.requestId ?? input.attemptId}.</BrandMuted>
      </td></tr><tr><td style={{ padding: "20px 32px", color: BRAND.textMuted, fontSize: 12 }}>ReconIQ. All rights reserved.</td></tr>
    </tbody></table></td></tr></tbody></table>
  </Body></Html>;
  return { subject, html: await render(element), text: await render(element, { plainText: true }) };
}
