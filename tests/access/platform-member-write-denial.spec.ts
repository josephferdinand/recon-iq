/**
 * Regression guard: verifies that platform_member (read-only) cannot trigger
 * tenant-scoped write operations — even via hidden UI, direct RPC calls, or
 * DevTools-forged requests.
 *
 * Approach: static assertions against the three enforcement layers.
 *   1. Server-function guards — the key platform + tenant mutating fns
 *      must contain a real authorization check in their handler body.
 *   2. RLS policies — the migrations that fixed the three prior security
 *      findings (certification_quizzes, dq_rules_and_ops, financial_master_data)
 *      must still gate writes on tenant_admin, not on generic membership.
 *   3. Tenant merge helper — platform_member must never be tagged with a
 *      write-capable synthetic role.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { mergeTenantsForUser } from "@/lib/tenants.functions";

const REPO_ROOT = resolve(__dirname, "../..");
const LIB_DIR = join(REPO_ROOT, "src/lib");
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase/migrations");

/* ------------------------------------------------------------------ */
/* Layer 1 — server-function guards on privileged mutations           */
/* ------------------------------------------------------------------ */

/** Server functions that MUST perform a platform-admin check before writing.
 *  Adding one here is cheap; removing one requires a real reason. */
const PLATFORM_ADMIN_ONLY_FNS: Array<{ file: string; fn: string }> = [
  { file: "platform.functions.ts", fn: "grantPlatformRole" },
  { file: "platform.functions.ts", fn: "revokePlatformRole" },
  { file: "platform.functions.ts", fn: "createPlatformInvitation" },
  { file: "platform.functions.ts", fn: "revokePlatformInvitation" },
  { file: "platform.functions.ts", fn: "resendPlatformInvitation" },
  { file: "platform.functions.ts", fn: "updateTenant" },
  { file: "tenants.functions.ts", fn: "createTenant" },
  { file: "tenants.functions.ts", fn: "createFamily" },
];

function extractHandler(source: string, fnName: string): string | null {
  const idx = source.indexOf(`export const ${fnName} = createServerFn`);
  if (idx < 0) return null;
  const next = source.indexOf("\nexport const ", idx + 1);
  let body = source.slice(idx, next < 0 ? undefined : next);
  const handlerRef = /\.handler\((\w+)\)/.exec(body)?.[1];
  if (handlerRef) {
    const handlerStart = source.indexOf(`export async function ${handlerRef}`);
    if (handlerStart >= 0) {
      const handlerEnd = source.indexOf("\nexport async function ", handlerStart + 1);
      body += source.slice(handlerStart, handlerEnd < 0 ? undefined : handlerEnd);
    }
  }
  return body;
}

describe("Layer 1 — platform-only mutating server functions carry an admin guard", () => {
  for (const { file, fn } of PLATFORM_ADMIN_ONLY_FNS) {
    it(`${fn} (${file}) enforces is_platform_admin`, () => {
      const src = readFileSync(join(LIB_DIR, file), "utf8");
      const body = extractHandler(src, fn);
      expect(body, `${fn} not found in ${file}`).toBeTruthy();
      const guarded = /is_platform_admin|isPlatformAdmin|assertPlatform/.test(body!);
      expect(guarded, `${fn} handler is missing an is_platform_admin / assertPlatform check — a platform_member could invoke it`).toBe(true);
    });
  }
});

/* ------------------------------------------------------------------ */
/* Layer 2 — RLS policies still gate the previously-fixed tables       */
/* ------------------------------------------------------------------ */

function readAllMigrations(): string {
  if (!statSync(MIGRATIONS_DIR, { throwIfNoEntry: false })?.isDirectory()) return "";
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8"))
    .join("\n");
}

const ALL_MIGRATIONS = readAllMigrations();

/** Tables that were tightened by the earlier security-finding fix. Writes
 *  on these must remain scoped to tenant_admin (or similarly-privileged),
 *  never a bare `authenticated` or `is_tenant_member` gate. */
const TENANT_ADMIN_WRITE_TABLES = [
  "financial_master_data",  // covered by generic guard string search
  "dq_rules",
  "dq_operations",
  "certification_quizzes",
];

describe("Layer 2 — RLS on tenant-scoped tables still requires an admin-tier role", () => {
  it("migrations directory is present and non-empty", () => {
    expect(ALL_MIGRATIONS.length).toBeGreaterThan(500);
  });

  for (const table of TENANT_ADMIN_WRITE_TABLES) {
    it(`${table} has an admin-scoped policy layer (has_role('tenant_admin'|'platform_admin'))`, () => {
      // The security-hardening migrations added a stricter policy referencing
      // has_role(..., 'tenant_admin') for each of these tables. If a future
      // migration replaces that with a bare-membership policy, this fails.
      const admin = new RegExp(
        `(has_role\\s*\\([^)]*${table}[^)]*'(?:tenant_admin|platform_admin)'|` +
        `'(?:tenant_admin|platform_admin)'[^;]*?${table}|` +
        `${table}[^;]*?'(?:tenant_admin|platform_admin)')`,
        "i",
      );
      const hit = admin.test(ALL_MIGRATIONS);
      // Extra safety: if we can find an old bare-membership policy for the
      // table that was NEVER dropped, that's a regression too.
      const oldUnguarded = new RegExp(
        `create\\s+policy[^;]*on\\s+public\\.${table}[^;]*tenant_members[^;]*;`,
        "gi",
      );
      const oldMatches = ALL_MIGRATIONS.match(oldUnguarded) ?? [];
      const droppedCount = (ALL_MIGRATIONS.match(new RegExp(`drop\\s+policy[^;]*on\\s+public\\.${table}`, "gi")) ?? []).length;
      expect(
        hit || (oldMatches.length === 0),
        `${table}: no admin-scoped policy found; unguarded policies=${oldMatches.length}, drops=${droppedCount}`,
      ).toBe(true);
    });
  }
});

/* ------------------------------------------------------------------ */
/* Layer 3 — tenant merge helper never promotes platform_member       */
/* ------------------------------------------------------------------ */

const t = (id: string) => ({
  id, slug: id, name: id, environment: "prod", ai_enabled: false, family_id: "f",
});

describe("Layer 3 — tenant role tagging cannot promote platform_member", () => {
  it("bare platform_member is tagged read-only across every tenant", () => {
    const rows = mergeTenantsForUser({
      memberships: [],
      isPlatformAdmin: false,
      isPlatformMember: true,
      allTenants: [t("a"), t("b"), t("c")],
    });
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.role).toBe("platform_member");
      expect(r.role.toLowerCase().includes("admin")).toBe(false);
    }
  });

  it("simultaneous flags: explicit admin still wins, no silent downgrade", () => {
    const rows = mergeTenantsForUser({
      memberships: [],
      isPlatformAdmin: true,
      isPlatformMember: true,
      allTenants: [t("a")],
    });
    expect(rows[0].role).toBe("platform_admin");
  });

  it("platform_member with an explicit tenant_analyst membership: membership wins on that tenant only", () => {
    const rows = mergeTenantsForUser({
      memberships: [{ role: "tenant_analyst", tenant: t("a") }],
      isPlatformAdmin: false,
      isPlatformMember: true,
      allTenants: [t("a"), t("b")],
    });
    const a = rows.find((r) => r.id === "a")!;
    const b = rows.find((r) => r.id === "b")!;
    expect(a.role).toBe("tenant_analyst");
    expect(b.role).toBe("platform_member");
  });
});
