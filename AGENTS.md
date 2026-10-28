# ReconIQ — Mandatory Agent Rules

These rules bind every human and AI agent working in this repository. They are not optional and they are not suspended by deadlines.

## Always-on skills

Before any code, schema, infra, deploy, or release work, invoke and follow:

1. **`rea`** (Rigorous Engineering & Assurance) — senior software engineer / solution architect discipline: root-cause fixes, bounded memory/resources, evidence before claims, hostile self-review of every diff. Canonical copy: user skill `~/.kimi-code/skills/rea/`; project copy: `.kimi-code/skills/rea/`.
2. **`cloudflare-security-audit`** — Cloudflare Pages/Workers security audit: secret handling, headers, WAF, caching, logging, Worker memory safety. Canonical copy: user skill `~/.kimi-code/skills/cloudflare-security-audit/`; project copy: `.kimi-code/skills/cloudflare-security-audit/`.
3. **`superpowers:systematic-debugging`** for every bug, test failure, or unexpected behaviour — root cause before fixes.

If a skill and a deadline conflict, cut scope, never safety.

## Non-negotiables

- **Secrets:** only in gitignored `.env.local` / `.dev.vars` or platform secret stores (Cloudflare secrets, Supabase). Never in source, `wrangler.jsonc` vars, git history, chat, issues, PRs, logs, screenshots, or built bundles. Never `VITE_`-prefixed. Report presence/length/shape only — never a value. Verify `git check-ignore .env.local` + grep the staged tree and `dist/` for secret patterns before every commit, push, and deploy.
- **Data protection:** classify data (public / internal / tenant-confidential / secret); log metadata only (ids, counts, hashes), never bodies, headers, tokens, file contents, or PII. Synthetic data only in demos, fixtures, and tests.
- **Access control:** RLS on and deny-by-default for tenant data; service-role key server-side only; no "temporary" public access, disabled RLS, or wildcard CORS — unblock with narrow policies for the exact flow.
- **Memory & resources:** stream large files, paginate lists, cap upload/body/row/page sizes before parsing, timeout + bounded-retry every external call, no module-scope accumulation of request data (memory leak = cross-tenant leak).
- **AI:** deterministic code computes financial truth; models (Muse / proxy) only explain and suggest, with human approval before any state change. Provider keys server-side; prompts carry no secrets and minimal tenant data.
- **Evidence:** "done/secure/passing" requires a run, probe, or diff a reviewer can inspect. State explicitly what was not verified. Sub-agent results are claims until spot-checked.

## Release gates (all must pass)

1. Secret scan of staged tree + built `dist/` — zero hits.
2. `bun run test:muse-adapter`, `bun run typecheck` (or documented blockers), `bun run build` succeed.
3. Cloudflare security audit (skill #2) — no open Critical/High findings without the owner's explicit written risk acceptance.
4. End-to-end demo verified live (login → upload → mapping → run → break → AI explanation → review → audit), plus one negative path (unauthenticated or wrong-tenant access denied).
5. README, `KNOWN_LIMITATIONS.md`, and provenance disclosure are accurate for what is being published.

Any agent that cannot satisfy a gate must say so plainly and stop — not route around it.
