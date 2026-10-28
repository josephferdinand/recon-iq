/**
 * Role-matrix regression for TENANT_PAGES after the IA rework.
 *
 * The 50→7 group consolidation only changed how items are labelled. The
 * permission fields must not have drifted: hidden pages stay hidden for a
 * user who lacks the permission, gated pages appear when granted, and
 * ungated pages are always visible.
 *
 * This mirrors what <LeftRail> does at render time, using the same
 * `permissionSet` filter contract.
 */
import { describe, it, expect } from "vitest";
import { TENANT_PAGES, type PageDef } from "@/lib/page-permissions";

function visibleFor(pages: PageDef[], granted: Set<string> | null): PageDef[] {
  return pages.filter((p) => {
    if (granted === null) return true;
    if (!p.permission) return true;
    return granted.has(p.permission);
  });
}

describe("Role matrix — tenant navigation gating", () => {
  it("Zero-permission role only sees ungated pages", () => {
    const empty = new Set<string>();
    const seen = visibleFor(TENANT_PAGES, empty);
    // Currently only "Knowledge" is ungated in the tenant rail.
    const seenKeys = seen.map((p) => p.key).sort();
    expect(seenKeys).toEqual(["kb"]);
  });

  it("A read-only auditor role sees exactly the pages granted", () => {
    const granted = new Set(["audit.log.read", "compliance.evidence.read"]);
    const seen = visibleFor(TENANT_PAGES, granted).map((p) => p.key).sort();
    expect(seen).toEqual(["audit", "dora", "kb"].sort());
  });

  it("Platform-scope bypass (permissionSet=null) shows every page", () => {
    const seen = visibleFor(TENANT_PAGES, null);
    expect(seen.length).toBe(TENANT_PAGES.length);
  });

  it("Every gated page hides for a user without the permission", () => {
    for (const page of TENANT_PAGES) {
      if (!page.permission) continue;
      const withoutIt = new Set(
        TENANT_PAGES.map((p) => p.permission).filter(
          (perm): perm is string => !!perm && perm !== page.permission,
        ),
      );
      const seenKeys = new Set(visibleFor(TENANT_PAGES, withoutIt).map((p) => p.key));
      expect(seenKeys.has(page.key), `${page.key} leaked without ${page.permission}`).toBe(false);
    }
  });

  it("Every gated page appears when its permission is granted", () => {
    for (const page of TENANT_PAGES) {
      if (!page.permission) continue;
      const seenKeys = new Set(
        visibleFor(TENANT_PAGES, new Set([page.permission])).map((p) => p.key),
      );
      expect(seenKeys.has(page.key), `${page.key} hidden despite ${page.permission}`).toBe(true);
    }
  });

  it("No tenant page uses an empty-string permission (typo guard)", () => {
    for (const page of TENANT_PAGES) {
      expect(page.permission === "" ? page.key : "").toBe("");
    }
  });
});
