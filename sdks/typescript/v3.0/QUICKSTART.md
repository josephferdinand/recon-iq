# FVI TypeScript SDK — Quickstart (v3.0)

## 1. Authenticate

```ts
import { FviClient } from "@falconveritas/fvi-sdk";

const fvi = new FviClient({
  token: process.env.FVI_TOKEN!,           // Supabase-issued JWT bearer
  baseUrl: "https://app-fvi.reconiq.example",
  timeoutMs: 15_000,
});

const session = await fvi.auth.getSession();
console.log("Signed in as", session);
```

## 2. List tenants

```ts
const tenants = await fvi.tenants.getTenants();
console.log(`${tenants.length} tenant(s) visible`);
```

## 3. Trigger and inspect a reconciliation run

```ts
const runs = await fvi.reconciliation.getReconRuns({
  tenant_id: "00000000-0000-0000-0000-000000000000",
});

const runId = runs[0].id;
const matches = await fvi.reconciliation.getReconRunsByIdMatches({ id: runId });
const breaks = await fvi.exceptions.getReconRunsByIdBreaks({ id: runId });
console.log({ matches: matches.length, breaks: breaks.length });
```

## 4. Export an audit bundle

```ts
const audit = await fvi.exports.getExportsAudit({
  format: "csv",
  from: "2026-01-01T00:00:00Z",
  to:   "2026-03-31T23:59:59Z",
});
```

## Migration note

v3 does not expose Webhooks, Copilot, or SOC 2 bundle endpoints. Upgrade to
`@falconveritas/fvi-sdk@4.0.0` for those surfaces.


## Error handling

```ts
import { FviApiError } from "@falconveritas/fvi-sdk";
try {
  await fvi.tenants.getTenants();
} catch (err) {
  if (err instanceof FviApiError) {
    console.error(err.status, err.body);   // 401 / 403 / 429 / 5xx
  } else {
    throw err;
  }
}
```
