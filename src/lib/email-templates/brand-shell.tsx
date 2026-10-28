import * as React from "react";

/**
 * ReconIQ Email Brand Shell
 * Per BRAND.md §3 (color palette), §4 (typography), §5 (logo).
 * Every ReconIQ email uses this shell so the visual identity is consistent
 * across signup, recovery, magic-link, invite, email-change, and reauthentication.
 *
 * Uses Inter (body/headings) and JetBrains Mono (eyebrows) loaded from Google Fonts
 * with system-font fallbacks for offline email clients.
 */

export const BRAND = {
  // BRAND.md §3
  primary: "#1e3a5f",
  primaryLight: "#3b5f87",
  accent: "#00d4ff",
  // backgrounds
  background: "#f4f6fa", // soft brand-tinted off-white
  surface: "#ffffff",
  border: "#e5e7eb",
  // text
  textPrimary: "#0a0e1a",
  textMuted: "#6b7280",
  textInverse: "#ffffff",
  // gradients
  ctaGradient: "linear-gradient(135deg, #1e3a5f 0%, #0a0e1a 100%)",
  heroGradient: "linear-gradient(135deg, #0a0e1a 0%, #1e3a5f 100%)",
  // BRAND.md §2
  tagline: "Recon, exceptions, and agentic AI on one ledger of truth.",
  // BRAND.md §5
  siteName: "ReconIQ",
  siteShort: "ReconIQ",
  // contact
  supportEmail: "support@reconiq.example",
  marketingSite: "https://www.reconiq.example",
  accountSite: "https://app.reconiq.example",
  // logo (CDN — public asset)
  monogramUrl: "https://app.reconiq.example/fv-monogram.svg",
  wordmarkUrl: "https://app.reconiq.example/og-fvi-1200x630.png",
  approvedLogoUrl: "https://app.reconiq.example/fv-monogram.svg",
} as const;

// Public inbox-safe URLs for the brand assets. The monogram is INLINED as an
// SVG string below so the email never depends on a remote fetch (which would
// be blocked in some clients or fail silently in offline previews).
export const ASSETS = {
  // The fv-monogram.svg is served from each Pages project. The remote URL is
  // kept for the cases where a remote fetch is preferable (e.g. an external
  // email client that disables inline SVG). When in doubt, use MONOGRAM_SVG.
  monogram: "https://www.reconiq.example/fv-monogram.svg",
  wordmark: "https://www.reconiq.example/og-fvi-1200x630.png",
  approvedLogo: "https://app.reconiq.example/fv-monogram.svg",
} as const;

/**
 * Legacy inlined ReconIQ monogram SVG, retained for compatibility. The email shell
 * now renders the approved raster master in its header. Inline SVGs:
 *  - never fail to load (no remote fetch)
 *  - render in every modern email client (Gmail, Outlook 2019+, Apple Mail)
 *    AND in the browser-based preview
 *  - inherit container dimensions (the width/height attrs override this)
 *  - scale crisply on retina displays
 *
 * Mirrors public/fv-monogram.svg — when the source SVG changes, update this
 * string in lockstep (BRAND.md §5 requires byte-identical brand assets).
 *
 * Rendered as proper JSX (not dangerouslySetInnerHTML) so the SVG markup is
 * type-checked at build time and React serializes it correctly. The string
 * form is kept as a fallback for clients that need raw SVG injection.
 */
export const MONOGRAM_SVG_STRING = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="40" height="40" role="img" aria-label="ReconIQ monogram" style="display:block;border:0;outline:none;text-decoration:none"><rect x="0" y="0" width="100" height="100" rx="6" fill="#1e3a5f"/><rect x="5" y="5" width="90" height="90" rx="3.5" fill="none" stroke="#00d4ff" stroke-width="1.4"/><text x="50" y="54" text-anchor="middle" dominant-baseline="central" fill="#f4ede0" font-family="Inter, 'Space Grotesk', ui-sans-serif, system-ui, sans-serif" font-weight="700" font-size="50" letter-spacing="-1.5">RQ</text></svg>`;

/** JSX form of the legacy monogram — retained for compatibility. */
export function Monogram({ size = 40 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role="img"
      aria-label="ReconIQ monogram"
      style={{ display: "block", border: 0, outline: "none", textDecoration: "none" }}
    >
      <rect x="0" y="0" width="100" height="100" rx="6" fill="#1e3a5f" />
      <rect
        x="5"
        y="5"
        width="90"
        height="90"
        rx="3.5"
        fill="none"
        stroke="#00d4ff"
        strokeWidth={1.4}
      />
      <text
        x="50"
        y="54"
        textAnchor="middle"
        dominantBaseline="central"
        fill="#f4ede0"
        fontFamily="Inter, 'Space Grotesk', ui-sans-serif, system-ui, sans-serif"
        fontWeight={700}
        fontSize={50}
        letterSpacing={-1.5}
      >
        RQ
      </text>
    </svg>
  );
}

interface BrandShellProps {
  preview: string; // preheader text (shows in inbox list view)
  children: React.ReactNode; // the main content block
  /** Optional override for the recipient's locale. Default: en-US. */
  locale?: string;
}

export function BrandShell({ preview, children, locale = "en" }: BrandShellProps) {
  return (
    <div
      lang={locale}
      style={{
        backgroundColor: BRAND.background,
        margin: 0,
        padding: "32px 16px",
        fontFamily:
          "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
        color: BRAND.textPrimary,
      }}
    >
      {/* Preheader (hidden in body, shows in inbox preview) */}
      <div
        style={
          {
            display: "none",
            maxWidth: 0,
            maxHeight: 0,
            overflow: "hidden",
            msoHide: "all",
            fontSize: 1,
            lineHeight: 1,
            color: BRAND.background,
          } as React.CSSProperties & { msoHide: string }
        }
      >
        {preview}
      </div>

      {/* Outer container */}
      <table
        role="presentation"
        cellPadding={0}
        cellSpacing={0}
        border={0}
        width="100%"
        style={{ maxWidth: 600, margin: "0 auto" }}
      >
        <tbody>
          <tr>
            <td>
              {/* Header band: approved raster mark on white + readable legal name */}
              <table
                role="presentation"
                cellPadding={0}
                cellSpacing={0}
                border={0}
                width="100%"
                style={{
                  backgroundImage: BRAND.heroGradient,
                  backgroundColor: BRAND.primary,
                  borderRadius: "12px 12px 0 0",
                  padding: "28px 32px",
                }}
              >
                <tbody>
                  <tr>
                    <td style={{ verticalAlign: "middle", paddingRight: 18, width: 148 }}>
                      <div
                        style={{
                          display: "inline-block",
                          backgroundColor: "#ffffff",
                          borderRadius: 6,
                          padding: 10,
                        }}
                      >
                        <img
                          src={ASSETS.approvedLogo}
                          width={128}
                          height={128}
                          alt="ReconIQ monogram"
                          style={{ display: "block", width: 128, height: 128, border: 0 }}
                        />
                      </div>
                    </td>
                    <td style={{ verticalAlign: "middle" }}>
                      <div
                        style={{
                          fontSize: 18,
                          fontWeight: 700,
                          color: BRAND.textInverse,
                          letterSpacing: "-0.01em",
                          lineHeight: 1.2,
                        }}
                      >
                        ReconIQ
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>

              {/* Body card */}
              <table
                role="presentation"
                cellPadding={0}
                cellSpacing={0}
                border={0}
                width="100%"
                style={{
                  backgroundColor: BRAND.surface,
                  borderLeft: `1px solid ${BRAND.border}`,
                  borderRight: `1px solid ${BRAND.border}`,
                  padding: "40px 32px",
                }}
              >
                <tbody>
                  <tr>
                    <td style={{ color: BRAND.textPrimary, fontSize: 16, lineHeight: 1.6 }}>
                      {children}
                    </td>
                  </tr>
                </tbody>
              </table>

              {/* Footer band */}
              <table
                role="presentation"
                cellPadding={0}
                cellSpacing={0}
                border={0}
                width="100%"
                style={{
                  backgroundColor: BRAND.surface,
                  borderLeft: `1px solid ${BRAND.border}`,
                  borderRight: `1px solid ${BRAND.border}`,
                  borderBottom: `1px solid ${BRAND.border}`,
                  borderRadius: "0 0 12px 12px",
                  padding: "20px 32px",
                }}
              >
                <tbody>
                  <tr>
                    <td
                      style={{
                        fontSize: 12,
                        lineHeight: 1.5,
                        color: BRAND.textMuted,
                        textAlign: "center",
                      }}
                    >
                      <div
                        style={{
                          fontFamily:
                            "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                          fontSize: 10,
                          letterSpacing: "0.08em",
                          textTransform: "uppercase",
                          color: BRAND.primary,
                          fontWeight: 500,
                          marginBottom: 8,
                        }}
                      >
                        {BRAND.tagline}
                      </div>
                      <div>
                        &copy; {new Date().getFullYear()} ReconIQ. All rights
                        reserved.
                      </div>
                      <div style={{ marginTop: 6 }}>
                        Need help?{" "}
                        <a
                          href={`mailto:${BRAND.supportEmail}`}
                          style={{ color: BRAND.primary, textDecoration: "underline" }}
                        >
                          {BRAND.supportEmail}
                        </a>
                      </div>
                      <div style={{ marginTop: 6 }}>
                        <a
                          href={BRAND.marketingSite}
                          style={{ color: BRAND.primary, textDecoration: "underline" }}
                        >
                          reconiq.example
                        </a>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>

              {/* Compliance microcopy below the card */}
              <div
                style={{
                  maxWidth: 600,
                  margin: "12px auto 0",
                  textAlign: "center",
                  fontSize: 11,
                  color: BRAND.textMuted,
                  lineHeight: 1.5,
                }}
              >
                You are receiving this transactional email because you have an account on ReconIQ.
                This message contains security-sensitive information; please
                do not forward it.
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/**
 * Standard CTA button. Uses an inline gradient + VML fallback for Outlook.
 * Aligned to BRAND.md §3 fvi-cta-gradient.
 */
export function BrandButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <table
      role="presentation"
      cellPadding={0}
      cellSpacing={0}
      border={0}
      style={{ margin: "8px 0 24px" }}
    >
      <tbody>
        <tr>
          <td
            align="center"
            style={{
              borderRadius: 8,
              backgroundImage: BRAND.ctaGradient,
              backgroundColor: BRAND.primary,
            }}
          >
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-block",
                padding: "14px 28px",
                fontSize: 15,
                fontWeight: 600,
                color: BRAND.textInverse,
                textDecoration: "none",
                letterSpacing: "0.01em",
                borderRadius: 8,
                border: `1px solid ${BRAND.primary}`,
                msoPaddingAlt: 0,
              }}
            >
              {children}
            </a>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

/** H1 used at the top of every email body. */
export function BrandH1({ children }: { children: React.ReactNode }) {
  return (
    <h1
      style={{
        margin: "0 0 12px",
        fontSize: 26,
        fontWeight: 800,
        color: BRAND.textPrimary,
        letterSpacing: "-0.02em",
        lineHeight: 1.2,
      }}
    >
      {children}
    </h1>
  );
}

/** Small uppercase eyebrow above the H1 (JetBrains Mono, per BRAND.md §4). */
export function BrandEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 500,
        color: BRAND.primary,
        textTransform: "uppercase",
        letterSpacing: "0.12em",
        fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        marginBottom: 8,
      }}
    >
      {children}
    </div>
  );
}

/** Body paragraph. */
export function BrandP({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        margin: "0 0 16px",
        fontSize: 15,
        lineHeight: 1.6,
        color: BRAND.textPrimary,
      }}
    >
      {children}
    </p>
  );
}

/** Muted secondary text. */
export function BrandMuted({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        margin: "16px 0 0",
        fontSize: 13,
        lineHeight: 1.5,
        color: BRAND.textMuted,
      }}
    >
      {children}
    </p>
  );
}

/** Inline-style link. */
export function BrandLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      style={{
        color: BRAND.primary,
        textDecoration: "underline",
        fontWeight: 500,
      }}
    >
      {children}
    </a>
  );
}
