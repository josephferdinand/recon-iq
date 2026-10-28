# @reconiq/api-contracts

Shared OpenAPI 3.1 types + Zod schemas used by both `@reconiq/marketing` and `@reconiq/app` for typed API contracts. Lives in `packages/api-contracts/`.

## Contents (when populated)

- Auto-generated TypeScript types from `openapi.yaml` (see `scripts/generate-openapi.ts`)
- Hand-authored Zod schemas for runtime validation at API boundaries
- Shared constants (e.g., scope strings, rate-limit tier names, error code enums)
- Request/response shapes for all v1 endpoints (see the repo root `README.md`)

## Import path

```ts
import type { Transaction, Tenant } from "@reconiq/api-contracts";
import { transactionSchema } from "@reconiq/api-contracts";
```

## Codegen

```bash
pnpm --filter @reconiq/api-contracts generate
```

Generates types + SDKs from the canonical `openapi.yaml` published at `docs.reconiq.example`.

## See Also

- Repo root `README.md` — project overview and setup