# ReconIQ — Reconciliation you can verify, break by break

**ReconIQ matches financial records deterministically — and explains every break in plain English.**

Upload two files (a ledger and a statement, a sub-ledger and a GL, any two sides of the same truth), map the columns, and ReconIQ reconciles them line by line. Exact matches clear instantly. Everything else becomes a *break* — classified, aged, assigned, and explained by an AI copilot that reads the evidence but **never touches the numbers**. Financial matching is always computed by the deterministic engine; AI only explains, summarises, and suggests next actions for a human to approve.

Built for the **Meta Developer Hackathon**, on Supabase and Cloudflare, with a pluggable AI provider (Meta Muse adapter included).

---

## Live demo

| | |
|---|---|
| **App** | https://reconintelligence.app |
| **Pages mirror** | https://reconiq.pages.dev |
| **Status** | https://reconintelligence.app/status |
| **Repository** | https://github.com/josephferdinand/recon-iq |

> Demo data is 100% synthetic. No real financial records are used anywhere in this project.

### The 5-minute judge tour (read-only)

A demo account is provisioned for reviewers:

1. Go to https://reconintelligence.app/auth and sign in:
   - **Email:** `judge@demo-bank.example`
   - **Password:** `nM&!PFJFDhHsxi*#nFJ9y@4&`
2. Open the **demo-bank** tenant.
3. Open reconciliation run **`R-20261028-F24079A0894D4AE7`** (Ledger vs Bank Statement — Demo).
4. Open exception **`FVI-EXC-A2EF1B5023F44E44A4B7262C24DFC5A1`** — the `DEMO-002` break (250.00 vs 249.00), already resolved by a human, with the resolution note on record.
5. Ask the Copilot: **“Explain break DEMO-002”** — it cites the exact records and the 1.00 difference.
6. Open the audit trail to see the hash-chained history of the run, the break, and the resolution.

The judge account is intentionally **read-only** (Recon Viewer role + business-unit view grants), so the tour cannot alter the demo. Both seeded demo exceptions are already resolved by design — the tour shows the completed evidence trail. To watch a *fresh* break happen, use the owner walkthrough below. **Rotate or revoke these demo credentials after judging** (see KNOWN_LIMITATIONS.md).

### The 2-minute hands-on demo (creates a fresh break)

Sign in with an owner/analyst account, open the demo tenant, and upload:

**Source file A**
```csv
reference,amount,currency,date
DEMO-001,100.00,USD,2026-10-29
DEMO-002,250.00,USD,2026-10-29
```

**Source file B**
```csv
reference,amount,currency,date
DEMO-001,100.00,USD,2026-10-29
DEMO-002,249.00,USD,2026-10-29
```

Map `reference → reference`, `amount → amount`, `currency`, `date`, then run. `DEMO-001` matches exactly; `DEMO-002` breaks by 1.00. Open the break, ask the Copilot to explain it, then approve, assign, or clear it — every step lands in the audit history.

### Product owners

The following accounts are provisioned as platform owners and demo-tenant administrators (passwords are held privately by the owner and are never published):

- `joseph.ferdinand@falconcortex.com`
- `joseph.ferdinand@falconaxiom.com`

## What ReconIQ does

- **Two-sided reconciliation** — CSV/Excel/PDF ingestion, column mapping, data preparation and normalisation, then deterministic matching on reference, amount, currency, and date with configurable tolerances.
- **Break management** — every unmatched or mismatched line becomes a tracked exception with reason, side, ageing, assignment, comments, and clearance workflow.
- **AI break explanation** — the Copilot reads the break evidence and explains *why* it likely broke and what to check next. Advisory only: it cannot create, alter, or clear a match.
- **Human-in-the-loop review** — analysts approve AI suggestions, manually match, or clear breaks; nothing financial is auto-posted by a model.
- **Audit everything** — logins, uploads, runs, matches, break actions, and AI calls are written to a hash-chained audit trail per tenant.
- **Multi-tenant by design** — tenants, business units, roles (platform admin, tenant admin, analyst, viewer), row-level security in Postgres, and tenant-isolated storage.

## Architecture

```
Browser (React 19)
   │
TanStack Start (SSR + server functions)  ──►  AI provider (break explanation)
   │  deployed on Cloudflare Pages              Meta Muse adapter, or any
   ▼                                            OpenAI-compatible endpoint
Supabase (managed Postgres + Auth + RLS)        configured server-side
   • 679 tables, 1,123 functions, 1,547 RLS policies (restored & counted live)
   • Email/password auth + MFA, tenant membership, hash-chained audit log
Cloudflare: Pages hosting, custom domain, WAF, security headers
```

| Layer | Technology |
|---|---|
| Frontend / SSR | React 19, TanStack Start & Router, Vite, Tailwind CSS 4, Radix UI |
| Backend | Supabase (Postgres, Auth, Row-Level Security), server functions |
| AI | Meta Muse adapter (offline-tested) via `META_*`; or any OpenAI-compatible provider via `AI_*` — server-side keys only. The live demo uses the configured provider endpoint. |
| Hosting | Cloudflare Pages (Nitro `cloudflare-pages` preset), custom domain `reconintelligence.app`, WAF + security headers |
| Tooling | Bun 1.3.14, TypeScript (`tsgo`), Vitest, Playwright |

## Quick start (local)

**Prerequisites:** [Bun](https://bun.sh) 1.3.14, a free [Supabase](https://supabase.com) project, a [Cloudflare](https://dash.cloudflare.com) account, and a Meta API key (or an OpenAI-compatible provider key).

```bash
git clone https://github.com/josephferdinand/recon-iq.git
cd recon-iq
bun install
cp .env.example .env.local   # fill in YOUR values — see Environment below
bun run dev
```

Then run the checks:

```bash
bun run test:muse-adapter   # offline Muse adapter smoke test (no network)
bun run typecheck           # TypeScript — currently zero errors
bun run build               # production build → dist/ (Cloudflare Pages)
```

> The build **requires** real Supabase values in `.env.local` — `vite.config.ts` refuses to build with placeholder keys, by design.

### Supabase setup (one-time, your own project)

1. Create a new Supabase project. Do **not** reuse any existing production project.
2. Enable extensions (Dashboard → Database → Extensions, or SQL): `pg_stat_statements`, `uuid-ossp`, `pgcrypto`, `supabase_vault`, `citext`, `pg_net`, `pg_cron`, `pgmq`, `ltree`, `vector`, `pg_trgm`, `plpgsql_check`. See `database/REQUIRED_EXTENSIONS.md`.
3. Apply **only** `database/production-schema.sql` (e.g. via `psql "$DATABASE_URL" -f database/production-schema.sql`). This creates the full application schema (677 `CREATE TABLE` statements in source; two constraints repaired during qualification — `UNIQUE (tenant_id, id)` added on `recon_definitions` and `business_units`).
   - ⚠️ Do **not** also run the 397 files in `supabase/migrations/` — that historical chain describes overlapping objects and expects historical data. See `database/README.md`.
4. Authentication → enable **Email/password**, and set Site URL / redirect URLs to your local (`http://localhost:3000`) and deployed URLs.
5. Create your first user, then bootstrap its platform/tenant membership in the database (no seed users or admin grants are shipped — see `KNOWN_LIMITATIONS.md`).
6. Create one tenant, invite your demo user, and run the 2-minute demo above with synthetic files.

### Environment

Copy `.env.example` to `.env.local`. **Never commit `.env.local`** (it is gitignored), and never prefix a secret with `VITE_`.

| Variable | Where | Purpose |
|---|---|---|
| `SUPABASE_PROJECT_REF` / `VITE_SUPABASE_PROJECT_ID` | Supabase → Settings → General | Project identifier |
| `SUPABASE_URL` / `VITE_SUPABASE_URL` | Supabase → Settings → API | Project API URL |
| `SUPABASE_PUBLISHABLE_KEY` / `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase → Settings → API | Public client key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API | **Server-only.** Bypasses RLS — Cloudflare secret only |
| `META_API_KEY` | Meta | **Server-only.** Muse API key |
| `META_API_BASE_URL` | — | `https://api.meta.ai/v1` |
| `META_MUSE_MODEL` | — | Defaults to `muse-spark-1.3` |
| `AI_API_KEY` / `AI_API_BASE_URL` | Optional provider | **Server-only.** OpenAI-compatible endpoint (Claude/GPT/Kimi models) |
| `APP_DATA_ENC_KEY` | Generate: `openssl rand -hex 32` | **Server-only.** AES-256-GCM data encryption |
| `ENVIRONMENT_PACKAGE_HMAC_KEY` | Generate: `openssl rand -hex 32` | **Server-only.** Package signing |

## Deploy to Cloudflare Pages

No custom domain required — a `pages.dev` subdomain is enough (the live demo additionally uses the custom domain `reconintelligence.app`).

```bash
bun run build                       # produces dist/
bun x wrangler login                # your Cloudflare account, browser flow
bun x wrangler pages deploy dist --project-name reconiq
```

Then in Cloudflare → Pages → `reconiq` → Settings → Environment variables, set the server-only secrets above (`SUPABASE_SERVICE_ROLE_KEY`, `META_API_KEY` or `AI_API_KEY`, `APP_DATA_ENC_KEY`, `ENVIRONMENT_PACKAGE_HMAC_KEY`) as **encrypted secrets**, and add your `pages.dev` URL to Supabase Auth redirect URLs. `wrangler.jsonc` already targets `./dist` with `nodejs_compat`; the public vars (`META_API_BASE_URL`, `META_MUSE_MODEL`) are set there.

## Security model

- Postgres Row-Level Security on tenant data, deny-by-default; the service-role key exists only as a server secret and is never shipped to the browser (verified at build time and by bundle secret scans — every deployment is scanned before publish).
- AI is advisory-only: deterministic code computes every match and break; model output is labelled, logged, and requires human approval for any state change. Prompts carry minimal tenant data and no secrets.
- Error handling follows a strict user-facing standard: no raw database errors, stack traces, or internal IDs are ever shown to users — every message explains what happened and what to do next, with a support reference ID.
- Compliance honesty: ReconIQ's controls are **designed with reference to** SOC 2 and ISO 27001 frameworks. ReconIQ does **not** hold SOC 2 or ISO 27001 certification, and the product says so plainly wherever frameworks are mentioned (see the [Security page](https://reconintelligence.app/security)).
- No credentials, users, or business data are included in this repository. All demo data is synthetic.
- Found a vulnerability? See `public/.well-known/security.txt` or the [contact page](https://reconintelligence.app/contact).

## What has been verified (2026-10-29)

- **Schema restore, counted live:** 679 tables, 1,123 functions, 1,547 RLS policies, 523 triggers, 13 extensions; RBAC seeded (78 permissions, 11 roles).
- **TypeScript typecheck:** zero errors. **Production build:** succeeds; `dist/` secret scan clean (only placeholder form hints match).
- **Live end-to-end (production):** sign-in with MFA → demo tenant → CSV upload → column mapping → deterministic run (`DEMO-001` matched, `DEMO-002` break) → AI explanation → human resolution → hash-chained audit history.
- **Judge tour:** verified through the judge account's own JWT against live RLS policies (runs, exceptions, comments readable; tenant isolation intact).
- **Negative paths:** signed-out deep links redirect to `/auth`; unauthenticated Copilot calls return 401; foreign-origin CORS is rejected; security headers present on responses.
- **Compliance sweep:** zero SOC 2/ISO certification claims anywhere in the product (grep-verified).
- Details and remaining honest gaps: [`VALIDATION.json`](VALIDATION.json) and [`KNOWN_LIMITATIONS.md`](KNOWN_LIMITATIONS.md).

## Project status & honest provenance

ReconIQ was prepared for the Meta Developer Hackathon from a pre-existing application codebase (internal codename **FVI / Falcon Veritas**), rebranded and re-qualified on personal accounts. It is **not** a byte-identical certified archive of any prior production deployment. The `FVI-*` reference IDs, `x-fvi-*` headers, and `*.reconiq.example` strings in internal placeholders use the RFC 2606 `.example` TLD intentionally and are retained for provenance; historical export records (`EXPORT_MANIFEST.json`, `database/schema-catalog.json`, `supabase/migrations/`) are retained unmodified.

## Repository layout

```
src/            TanStack Start app (routes, components, server functions, lib)
database/       Fresh-project schema (production-schema.sql), extension & ACL docs
supabase/       Edge function (send-email), config, historical migrations (do not apply to a fresh project — see above)
workers/        Optional Cloudflare Workers (status monitor, MCP gateway, schedulers)
cloudflare/     Pages/Workers configuration artefacts
packages/       Shared UI, brand, API contracts, Supabase client
apps/           App & marketing workspace stubs
scripts/        Operational and QA scripts (review before running against any environment)
tests/          Vitest + Playwright suites
docs/           Project documentation
```

## Contributing

Issues and PRs are welcome. Please use synthetic data in every reproduction, never paste credentials or real financial records into issues, and run `bun run typecheck` + the focused test for your change before opening a PR.

## Licence

MIT — see [`LICENSE`](LICENSE). Copyright (c) 2026 Joseph Ferdinand.
