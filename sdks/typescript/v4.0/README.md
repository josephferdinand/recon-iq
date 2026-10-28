# @falconveritas/fvi-sdk (v4.0)

Official TypeScript SDK for the ReconIQ (FVI) reconciliation
platform, generated from `docs/openapi/fvi-openapi.yaml`.

- **API version:** 4.0.0
- **Base URL:** https://app-fvi.reconiq.example
- **Operations:** 36 across 11 tags (Auth, Tenants, Reconciliation, Exceptions, Exports, Webhooks, Admin, Connectors, Copilot, Observability, Data Prep)
- **Runtime:** Node 18+, Bun, Deno, modern browsers (uses global `fetch`)
- **Auth:** Supabase-issued JWT bearer, tenant-scoped via RLS

## Install

```bash
npm install @falconveritas/fvi-sdk@4.0
# or
bun add @falconveritas/fvi-sdk@4.0
```

## Quickstart

See [QUICKSTART.md](./QUICKSTART.md) for end-to-end examples covering auth,
listing tenants, triggering reconciliation runs, exporting audit bundles,
and verifying inbound webhooks.

## Support policy

**Current (Latest).** New integrations MUST target v4.
