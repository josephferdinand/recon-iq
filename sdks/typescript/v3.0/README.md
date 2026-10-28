# @falconveritas/fvi-sdk (v3.0)

Official TypeScript SDK for the ReconIQ (FVI) reconciliation
platform, generated from `docs/openapi/fvi-openapi-v3.yaml`.

- **API version:** 3.0.0
- **Base URL:** https://app-fvi.reconiq.example
- **Operations:** 8 across 7 tags (Auth, Tenants, Reconciliation, Exceptions, Exports, Admin, Observability)
- **Runtime:** Node 18+, Bun, Deno, modern browsers (uses global `fetch`)
- **Auth:** Supabase-issued JWT bearer, tenant-scoped via RLS

## Install

```bash
npm install @falconveritas/fvi-sdk@3.0
# or
bun add @falconveritas/fvi-sdk@3.0
```

## Quickstart

See [QUICKSTART.md](./QUICKSTART.md) for end-to-end examples covering auth,
listing tenants, triggering reconciliation runs, exporting audit bundles,
and verifying inbound webhooks.

## Support policy

**Archived.** Read-only bug fixes only; sunsets 2026-Q4. Migrate to v4.
