# @reconiq/supabase-client

Supabase clients (publishable + service-role + generated types) shared across `@reconiq/marketing` and `@reconiq/app`. Lives in `packages/supabase-client/`.

## Contents (when extracted)

- `createBrowserClient(env)` — publishable-key client, RLS-enforced, safe in browser bundle
- `createServerClient(env)` — server-only client with publishable key + RLS
- `createServiceRoleClient(env)` — server-only admin client (audit-justified usage only; see LL-002)
- `createSchemaScopedClient(env, schema)` — marketing_writer or app_writer client
- Generated DB types from `supabase gen types typescript`
- `validateJwtStructure()` helper (moved from app auth-middleware per LL-007 future recommendation)

## Schema-scoped roles

Per the repo root `README.md`:

- `marketing_writer` — `CRUD` on `marketing.*`; read on `app.brand_themes`; read on `auth.users` for lead attribution
- `app_writer` — `CRUD` on `app.*`; read on `marketing.*`; read on `auth.users`

Each role is a separate Postgres login. Secrets in Cloudflare Pages:

- Marketing: `SUPABASE_MARKETING_WRITER_KEY`
- App: `SUPABASE_APP_WRITER_KEY`

## Import path

```ts
import { createBrowserClient, createServiceRoleClient } from "@reconiq/supabase-client";
```

## See Also

- Repo root `README.md` — project overview and schema-scoped roles
- `lessons-learned.md` LL-002 — service_role audit rule
- `lessons-learned.md` LL-007 — JWT pre-validation