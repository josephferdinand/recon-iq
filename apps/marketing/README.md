# @reconiq/marketing

Public marketing surface for ReconIQ — deployed to `reconiq.example`, `www.reconiq.example`, and `staging-marketing.reconiq.example`.

## Scope

Routes (see the repo root `README.md`):

- `/`, `/about`, `/pricing`, `/contact`, `/book-demo`
- `/solutions/index`, `/solutions/$slug`
- `/roi`, `/review/videos`, `/due-diligence`, `/security`, `/enterprise-faq`, `/retention`
- `/developers`, `/developers/index`, `/developers/api-reference`, `/developers/changelog`, `/developers/guides`
- `/support`, `/support/index`, `/support/$category/index`, `/support/$category/$article`
- `/status` (public status page), `/sitemap[.]xml`
- `/t/$slug`, `/t/$slug/auth` (pre-auth tenant-branded sign-in)

Public API endpoints (only marketing-allocated):

- `/api/public/mkt-leads`, `/api/public/mkt-chat`, `/api/public/mkt-cta-events`
- `/api/public/mkt-appointments`, `/api/public/mkt-site-logos`
- `/api/public/regulatory/packs.ts`
- `/api/public/status.json` (public status)

## Components

- `marketing-nav.tsx`, `fvi-landing-additions.tsx`, `fvi-agentic-showcase.tsx`
- `fvi-demo-player.tsx`, `fvi-neural.tsx`, `mkt-theme-mount.tsx`, `mkt-widget-mount.tsx`
- `solution-page.tsx`, `site-admin-footer-link.tsx`, `theme-picker.tsx`
- `theme-provider.tsx`, `dr-falcon-widget.tsx`

## Security posture

- Cloudflare Turnstile on every form (`/contact`, `/book-demo`, newsletter)
- CSP `script-src 'self' 'nonce-...' 'strict-dynamic'`; first 30 days Report-Only, then enforce
- Rate limit 5/min/IP on `/api/public/mkt-*` (lead capture spam protection)
- CORS: full `ALLOWED_ORIGINS` whitelist (per §3.8)
- Schema-scoped Postgres role: `marketing_writer` only — no access to `app.*`

## Defer to app

Anything auth-gated or sensitive (e.g., `/mkt-admin/*`) lives in `@reconiq/app` despite the name. See the repo root `README.md`.

## See Also

- Repo root `README.md` — project overview, deploy and env var setup
- `@reconiq/ui` — shared Radix primitives
- `@reconiq/brand` — theme + monogram