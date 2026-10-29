# Known limitations — stated plainly

ReconIQ is a live, working hackathon MVP. This file lists what is intentionally limited, unfinished, or cosmetic, so reviewers are never misled. Nothing here blocks the verified demo flow.

## Demo & accounts

- The judge account (`judge@demo-bank.example`, password in README's judge tour) is **read-only by design** (Recon Viewer role + business-unit view grants). Both seeded demo exceptions are already resolved — the tour shows the completed evidence and audit trail. Run the 2-minute CSV walkthrough (README) to watch a fresh break happen. **Revoke the judge grants or rotate the password after judging.**
- The judge sign-in was verified through the account's own JWT against live RLS policies (auth API + row visibility). The agent deliberately did not type the password into a browser; the sign-in form itself was verified live with owner accounts.
- Demo data is synthetic. The demo tenant is shared by all reviewers — please don't delete the seeded runs.

## Product surface

- The user-facing error standard (human title + what happened + what to do next, no raw technical detail) is fully applied across the public site, auth, and the demo path (reconciliation, exceptions, Copilot, audit). A number of admin/platform toasts still pass through raw messages; the shared pattern lives in `src/lib/user-facing-errors.ts` and remaining surfaces are migrated incrementally.
- Marketing and auth surfaces use the Onyx theme. Inside the authenticated app, some charts and widgets still use functional accent colours (cyan/violet) from the data-visualisation palette.
- Small cosmetic items tracked for polish: break-drawer comments appear after a reload rather than refreshing in place; reference-data open ranges render as "to 9999-12-31"; the guided tour contains one legacy "F" tile.
- Homepage-era components (`fvi-neural`, `fvi-agentic-showcase`, `fvi-tenant-isolation`, `fvi-inline-admin`, `fvi-demo-player`) are no longer imported by the redesigned site but remain in `src/components/` for reference.
- The request-invite page intentionally has no marketing footer (it mirrors the focused sign-in flow).

## Platform & operations

- No mailbox is provisioned on `reconintelligence.app` yet; contact happens through the `/contact` and `/support` forms. Social-preview images use the SVG monogram (`og:image`) — a raster 1200×630 card is a nice-to-have.
- `*.reconiq.example` remains only in legacy host-routing allowlists, placeholder guards, and historical provenance records (RFC 2606 `.example` — non-resolving by design). All functional defaults, docs samples, email templates, and public pages use `reconintelligence.app`.
- The internal codename **FVI / Falcon Veritas** persists in reference IDs (`FVI-EXC-…`), `x-fvi-*` headers, and some internal identifiers. This is deliberate provenance, not a second brand.
- `supabase/migrations/` (397 historical files) must **not** be run against a fresh project; `database/production-schema.sql` is the supported restore path (see `database/README.md`).
- Mobile sign-in was verified via browser device emulation, not on a physical device.

## AI

- The live demo's AI explanations route through an OpenAI-compatible provider configured server-side. The direct Meta Muse adapter is included and passes its offline smoke test (`bun run test:muse-adapter`); it was not exercised against the live Meta endpoint in this environment.
- AI output is advisory only by design: it explains and suggests; deterministic code computes all financial truth and a human approves every state change.

## Compliance honesty

- ReconIQ holds **no** SOC 2, ISO 27001, or other certification. Controls are designed with reference to those frameworks; the product copy says exactly that and nothing more. The engineering standard targets certification-grade quality so a future audit has no surprises — that is a goal, not a claim.
