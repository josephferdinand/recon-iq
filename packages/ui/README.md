# @reconiq/ui

Shared Radix UI wrappers used by both `@reconiq/marketing` and `@reconiq/app`. Lives in `packages/ui/`.

## Contents (when extracted)

- Button, Card, Dialog, Badge, Tabs, Select, Toast, Tooltip, Sheet
- All wrappers are thin — they apply ReconIQ design tokens but expose full Radix props
- No business logic; this package is presentational only

## Import path

```ts
import { Button, Card } from "@reconiq/ui";
```

Path alias is wired in `tsconfig.base.json` and `turbo.json` (`@reconiq/ui` → `packages/ui/src/index.ts`).

## See Also

- Repo root `README.md` — project overview and monorepo layout
- `@reconiq/brand` — color tokens, typography, theme provider