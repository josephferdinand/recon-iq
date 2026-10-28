# @reconiq/brand

ReconIQ brand package — FV monogram, color tokens, typography, theme provider. Lives in `packages/brand/`.

## Contents (when extracted)

- `FVMonogram.tsx` — the F+V monogram SVG component
- `theme-provider.tsx`, `theme-picker.tsx` — light/dark theme plumbing
- Color tokens (CSS variables + Tailwind config export)
- Typography scale (Inter for body, JetBrains Mono for code)
- Logo lockups and brand asset metadata

## Import path

```ts
import { FVMonogram, ThemeProvider } from "@reconiq/brand";
```

## Brand assets in R2

Production brand assets live in `fvi-brand-assets` R2 bucket (preview: `fvi-brand-assets-preview`). See `apps/marketing/wrangler.toml` binding `BRAND_ASSETS`.

## See Also

- Repo root `README.md` — project overview and setup
- `@reconiq/ui` — uses brand tokens internally