# @reconiq/lib-shared

Cross-surface utility library shared by both `@reconiq/marketing` and `@reconiq/app`. Lives in `packages/lib-shared/`.

## Contents (when populated)

Today this package is mostly empty — it grows as marketing and app share logic. Future candidates:

- Date/time formatting helpers
- Currency formatting (multi-currency reconciliation)
- Tenant slug validation (`/t/:slug` → branded URL)
- Shared analytics event schemas
- Common Zod primitives (UUID, tenant ID, ISO timestamp)

## Import path

```ts
import { formatCurrency, isValidTenantSlug } from "@reconiq/lib-shared";
```

## Rule

If a function is used by both surfaces AND it has no UI / no DB / no auth dependency, it belongs here.

## See Also

- Repo root `README.md` — project overview and monorepo layout
- Lint rule forbids cross-app imports; only `packages/*` is allowed