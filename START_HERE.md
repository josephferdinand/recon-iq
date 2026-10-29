# ReconIQ — Meta hackathon source package

This is a separate full application-source export for your personal accounts. The source project was not modified or deployed. The temporary brand is **ReconIQ**; you can change it.

## What you have

- Complete selected application roots: frontend/server source, administration and workspace features, reconciliation engine, data preparation, workers, functions, packages, SDKs, tests, assets and operational source scripts.
- A current production **structure-only** database catalog: 677 tables, 1,163 routines, 1,547 policies and related object definitions. Extension-owned definitions remain in the catalog and are supplied by extensions during restore.
- A generated fresh-project schema SQL file, explicit ACL inventory, extension requirements and historical migration files.
- A direct Meta Muse transport, default model `muse-spark-1.3`, configurable through your own server secrets. No old provider SDK package is required by the rewritten adapter. The SDK streaming interface currently delivers a buffered answer.
- Placeholder-only personal deployment configuration and environment template. No source credentials, accounts, business rows, Git history or private handovers are included.

## Important source provenance

The recoverable GitHub main revision is older than the recovered working application. This package therefore preserves the recovered application source, including unpublished changes, rather than silently replacing it with the older Git snapshot. The database metadata is freshly captured from production using read-only catalogs. This is **not a byte-identical certified source archive of the last production build**. Consult EXPORT_MANIFEST.json and KNOWN_LIMITATIONS.md for qualification.

## Personal setup

1. Create your own Supabase project, GitHub repository and Cloudflare project. Do not link this folder to the original project repository or accounts.
2. Read `database/README.md`. Enable required supported extensions and qualify the schema on your NEW database. This export has not been applied to a new project yet. Do not run the historical migration chain blindly.
3. Copy `.env.example` to `.env.local` and supply only your new project reference, URL and public key. Supply server-only values through local private configuration or Cloudflare secrets; never prefix secret values with `VITE_`.
4. Configure `META_API_KEY` with your own Meta account key. `META_API_BASE_URL` is `https://api.meta.ai/v1`; `META_MUSE_MODEL` defaults to `muse-spark-1.3`. Select a permitted Muse model available in your account. No model request was made while packaging.
5. Install the dependencies in this folder using Bun 1.3.14. Lockfiles were intentionally not copied because the dependency set changed; generate a fresh lockfile and review it. No dependency installation was performed during export.
6. Use `bun run dev`, `bun run typecheck`, `bun run test:muse-adapter` and your focused flow checks. A full application build and hosted end-to-end run remain to be qualified with your own environment.
7. Enable email/password in your new Supabase project, set your own site/redirect URLs, create a new user and bootstrap the required platform/tenant membership through the actual schema. No original users or admin grants are copied.
8. Configure each optional worker binding, bucket, queue and connector that you choose to use. The main deployment configs have no original project bindings. Optional worker configs are templates and require review before activation.
9. Deploy from your personal repository to Cloudflare Pages. A `pages.dev` URL can be used without buying a domain. Do not deploy before reviewing the new project's bindings and security findings.

## Demonstration

Show platform administration, one tenant, email/password login, two synthetic input files, mapping, reconciliation, results, AI-assisted break explanation, user review and audit history. Financial matches remain calculated by the deterministic engine.

Suggested new synthetic files:

```csv
reference,amount,currency,date
DEMO-001,100.00,USD,2026-10-29
DEMO-002,250.00,USD,2026-10-29
```

```csv
reference,amount,currency,date
DEMO-001,100.00,USD,2026-10-29
DEMO-002,249.00,USD,2026-10-29
```

## Reference documentation

- Meta API: https://dev.meta.ai/docs/protocols/chat-completions
- Email/password: https://supabase.com/docs/guides/auth/passwords
- Pages hosting: https://developers.cloudflare.com/pages/framework-guides/deploy-anything/

This package is local only. It has not been uploaded to a repository or deployed. Verify event rules and disclose pre-existing foundations accurately when preparing your submission. Public source publication exposes the selected proprietary source; choose the license you intend before publishing.
