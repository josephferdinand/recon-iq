// @vitest-environment jsdom
/**
 * Deep-link breadcrumb coverage.
 *
 * For every tenant page key AND every platform page key (mirrored from
 * platform.tsx), asserts that RailBreadcrumbs resolves a "Scope › Group ›
 * Page" trail. This is the same code path a refresh or shared deep link
 * hits, so passing tests here mean bookmarks survive the IA rework.
 */
import { describe, it, expect } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { RailBreadcrumbs, type RailItem } from "@/components/left-rail";
import { TENANT_PAGES } from "@/lib/page-permissions";

// Platform PAGES manifest is authored inside src/routes/_authenticated/platform.tsx.
// Mirrored here to avoid coupling tests to route-file internals; the
// ia-groups.spec.ts guardrail keeps the group set in sync.
const PLATFORM_PAGES: RailItem[] = [
  { key: "tenants",         label: "Tenants",           group: "Tenancy" },
  { key: "families",        label: "Families",          group: "Tenancy" },
  { key: "entitlements",    label: "Entitlements",      group: "Tenancy" },
  { key: "roadmap",         label: "Next Wave roadmap", group: "Tenancy" },
  { key: "rbac",            label: "RBAC",              group: "Identity & Access" },
  { key: "groups",          label: "Groups",            group: "Identity & Access" },
  { key: "access-explorer", label: "Access explorer",   group: "Identity & Access" },
  { key: "user-analytics",  label: "User analytics",    group: "Identity & Access" },
  { key: "ai-gov",          label: "AI Governance",     group: "AI Governance" },
  { key: "llm",             label: "LLM providers",     group: "AI Governance" },
  { key: "kb",              label: "Knowledge",         group: "Content & Support" },
  { key: "kb-templates",    label: "KB Templates",      group: "Content & Support" },
  { key: "process-library", label: "Process Library",   group: "Content & Support" },
  { key: "tickets",         label: "Escalations",       group: "Content & Support" },
  { key: "audit",           label: "Audit",             group: "Security & Compliance" },
  { key: "security-audit",  label: "Security Audit",    group: "Security & Compliance" },
  { key: "break-glass",     label: "Break-Glass",       group: "Security & Compliance" },
  { key: "secrets",         label: "Secrets",           group: "Security & Compliance" },
  { key: "residency",       label: "Residency denials", group: "Security & Compliance" },
  { key: "pii-events",      label: "PII redactions",    group: "Security & Compliance" },
  { key: "policy-auditor",  label: "Policy auditor",    group: "Security & Compliance" },
  { key: "github",          label: "GitHub sync",       group: "Security & Compliance" },
  { key: "promo",           label: "Promotion",         group: "Security & Compliance" },
  { key: "status",          label: "Status page",       group: "Reliability & Ops" },
  { key: "recon-health",    label: "Recon health",      group: "Reliability & Ops" },
  { key: "worker-health",   label: "Worker health",     group: "Reliability & Ops" },
  { key: "migrations",      label: "Migrations",        group: "Reliability & Ops" },
  { key: "benchmarks",      label: "Benchmarks",        group: "Reliability & Ops" },
  { key: "schema-drift",    label: "Schema drift",      group: "Reliability & Ops" },
  { key: "cross-recon",     label: "Cross-recon",       group: "Reliability & Ops" },
];

function assertTrail(items: RailItem[], scope: string, key: string) {
  const item = items.find((i) => i.key === key)!;
  const { container, unmount } = render(
    <RailBreadcrumbs items={items} activeKey={key} scopeLabel={scope} />,
  );
  const text = (container.textContent ?? "").trim();
  expect(text, `${scope} / ${key}`).toContain(scope);
  expect(text, `${scope} / ${key}`).toContain(item.group!);
  expect(text, `${scope} / ${key}`).toContain(item.label);
  unmount();
}

describe("Breadcrumbs cover every deep link — Platform", () => {
  for (const p of PLATFORM_PAGES) {
    it(`Platform › ${p.group} › ${p.label}`, () => {
      assertTrail(PLATFORM_PAGES, "Platform", p.key);
      cleanup();
    });
  }
});

describe("Breadcrumbs cover every deep link — Tenant", () => {
  for (const p of TENANT_PAGES) {
    it(`Tenant › ${p.group} › ${p.label}`, () => {
      assertTrail(TENANT_PAGES as unknown as RailItem[], "Tenant", p.key);
      cleanup();
    });
  }
});
