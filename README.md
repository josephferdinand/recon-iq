# ReconIQ — Enterprise Reconciliation, Explained by AI

**ReconIQ matches financial records deterministically — and explains every break in plain English.**

Upload two files (a ledger and a statement, a sub-ledger and a GL, any two sides of the same truth), map the columns, and ReconIQ reconciles them line by line. Exact matches clear instantly. Everything else becomes a *break* — classified, aged, assigned, and explained by an AI copilot that reads the evidence but **never touches the numbers**. Financial matching is always calculated by the deterministic engine; AI only explains, summarises, and suggests next actions for a human to approve.

Built for the **Meta Developer Hackathon** on Meta Muse Spark, Supabase, and Cloudflare.

---

## Live demo

| | |
|---|---|
| **App** | _Cloudflare Pages `pages.dev` URL — added on deployment_ |
| **Status** | _Linked from the in-app status page_ |
| **Demo login** | Email/password (created in your own Supabase project — see Setup) |

> Demo data is 100% synthetic. No real financial records are used anywhere in this project.

### The 2-minute demo

1. Sign in with email/password.
2. Open the demo tenant and upload the two sample files below.
3. Map `reference → reference`, `amount → amount`, `currency`, `date`.
4. Run reconciliation. `DEMO-001` matches exactly; `DEMO-002` breaks (250.00 vs 249.00).
5. Open the break and ask the AI copilot to explain it. It cites the exact records and difference — then a human approves, assigns, or clears it. Every step lands in the audit history.

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

## What ReconIQ does

- **Two-sided reconciliation** — CSV/Excel/PDF ingestion, column mapping, data preparation and normalisation, then deterministic matching on reference, amount, currency, and date with configurable tolerances.
- **Break management** — every unmatched or mismatched line becomes a tracked exception with reason, side, ageing, assignment, comments, and clearance workflow.
- **AI break explanation (Meta Muse)** — Muse Spark reads the break evidence and explains *why* it likely broke and what to check next. Advisory only: it cannot create, alter, or clear a match.
- **Human-in-the-loop review** — analysts approve AI suggestions, manually match, or clear breaks; nothing financial is auto-posted by a model.
- **Audit everything** — logins, uploads, runs, matches, break actions, and AI calls are written to an audit trail per tenant.
- **Multi-tenant by design** — tenants, business units, roles (platform admin, tenant admin, analyst, viewer), row-level security in Postgres, and tenant-isolated storage.

## Architecture

```
Browser (React 19)
   │
TanStack Start (SSR + server functions)  ──►  Meta Muse API (break explanation)
   │  deployed on Cloudflare Pages              (or an OpenAI-compatible AI proxy)
   ▼
Supabase (managed Postgres + Auth + RLS)
   • 676 application tables, 1,000+ functions, 1,500+ RLS policies
   • Email/password auth, tenant membership, audit log
Cloudflare Workers (optional): status monitor, MCP gateway, schedulers
```

| Layer | Technology |
|---|---|
| Frontend / SSR | React 19, TanStack Start & Router, Vite, Tailwind CSS 4, Radix UI |
| Backend | Supabase (Postgres 17, Auth, Row-Level Security), server functions |
| AI | Meta Muse Spark (`muse-spark-1.3`) via direct Meta API; optional OpenAI-compatible proxy (Claude / GPT / Kimi models) for non-hackathon deployments |
| Hosting | Cloudflare Pages (Nitro `cloudflare-pages` preset), optional Workers |
| Tooling | Bun 1.3.14, TypeScript, Vitest, Playwright |

## Quick start (local)

**Prerequisites:** [Bun](https://bun.sh) 1.3.14, a free [Supabase](https://supabase.com) project, a [Cloudflare](https://dash.cloudflare.com) account, and a Meta API key (or an OpenAI-compatible proxy key).

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
bun run typecheck           # TypeScript
bun run build               # production build → dist/ (Cloudflare Pages)
```

> The build **requires** real Supabase values in `.env.local` — `vite.config.ts` refuses to build with placeholder keys, by design.

### Supabase setup (one-time, your own project)

1. Create a new Supabase project. Do **not** reuse any existing production project.
2. Enable extensions (Dashboard → Database → Extensions, or SQL): `pg_stat_statements`, `uuid-ossp`, `pgcrypto`, `supabase_vault`, `citext`, `pg_net`, `pg_cron`, `pgmq`, `ltree`, `vector`, `pg_trgm`, `plpgsql_check`. See `database/REQUIRED_EXTENSIONS.md`.
3. Apply **only** `database/production-schema.sql` (e.g. via `psql "$DATABASE_URL" -f database/production-schema.sql`). This creates the full application schema.
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
| `AI_API_KEY` / `AI_API_BASE_URL` | Optional proxy | **Server-only.** OpenAI-compatible proxy (Claude/GPT/Kimi) |
| `APP_DATA_ENC_KEY` | Generate: `openssl rand -hex 32` | **Server-only.** AES-256-GCM data encryption |
| `ENVIRONMENT_PACKAGE_HMAC_KEY` | Generate: `openssl rand -hex 32` | **Server-only.** Package signing |

## Deploy to Cloudflare Pages

No custom domain required — a `pages.dev` subdomain is enough.

```bash
bun run build                       # produces dist/
bunx wrangler login                 # your Cloudflare account, browser flow
bunx wrangler pages deploy dist --project-name reconiq
```

Then in Cloudflare → Pages → `reconiq` → Settings → Environment variables, set the server-only secrets above (`SUPABASE_SERVICE_ROLE_KEY`, `META_API_KEY`, `APP_DATA_ENC_KEY`, `ENVIRONMENT_PACKAGE_HMAC_KEY`) as **encrypted secrets**, and add your `pages.dev` URL to Supabase Auth redirect URLs. `wrangler.jsonc` already targets `./dist` with `nodejs_compat`; the public vars (`META_API_BASE_URL`, `META_MUSE_MODEL`) are set there.

## Security model

- Postgres Row-Level Security on tenant data; service-role key exists only as a server secret and is never shipped to the browser (verified at build time — `vite.config.ts` fails the build if Supabase config is missing or inconsistent).
- AI is advisory-only: deterministic code computes every match and break; model output is labelled, logged, and requires human approval for any state change.
- No credentials, users, or business data are included in this repository. All demo data is synthetic.
- Found a vulnerability? See `public/.well-known/security.txt`.

## Project status & honest provenance

ReconIQ was prepared for the Meta Developer Hackathon from a pre-existing recovered application codebase, rebranded and re-qualified for personal accounts. It is **not** a byte-identical certified archive of any prior production deployment. Known gaps, the untested-on-delivery fresh-restore qualification, and inherited review items are documented openly in [`KNOWN_LIMITATIONS.md`](KNOWN_LIMITATIONS.md) and [`VALIDATION.json`](VALIDATION.json). Historical export records (`EXPORT_MANIFEST.json`, `database/schema-catalog.json`, `supabase/migrations/`) are retained unmodified for provenance.

What has been verified in this repository: dependency install (Bun), offline Muse adapter smoke test, and a production Vite/Nitro build for Cloudflare Pages. Database restore, live Muse calls, and the hosted end-to-end demo are qualified during setup (see status issues / releases for the latest evidence).

## Repository layout

```
src/            TanStack Start app (routes, components, server functions, lib)
database/       Fresh-project schema (production-schema.sql), extension & ACL docs
supabase/       Edge function (send-email), config, historical migrations (do not apply to a fresh project — see above)
workers/        Optional Cloudflare Workers (status monitor, MCP gateway, schedulers)
packages/       Shared UI, brand, API contracts, Supabase client
apps/           App & marketing workspace stubs
scripts/        Operational and QA scripts (review before running against any environment)
tests/          Vitest + Playwright suites
```

## Contributing

Issues and PRs are welcome once the repository is public. Please use synthetic data in every reproduction, never paste credentials or real financial records into issues, and run `bun run typecheck` + the focused test for your change before opening a PR.

## Licence

_Licence to be added by the repository owner before public release._
