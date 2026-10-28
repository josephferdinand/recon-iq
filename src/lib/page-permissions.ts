/**
 * Single source of truth that maps every page key (workspace / tenant / platform)
 * to the permission required to view it.
 *
 * Keys correspond to the `?page=<key>` query param used by the LeftRail.
 * `null` means the page has no permission gate (always visible).
 *
 * If you add a page, register it here too. The Access Explorer reads this
 * map to render the "Page coverage" matrix.
 */

export type PageDef = {
  key: string;
  label: string;
  permission: string | null;
  group?: string;
};

export const WORKSPACE_PAGES: PageDef[] = [
  { key: "dashboard",         label: "Dashboard",              permission: null, group: "Workspace" },
  { key: "ingest",            label: "Ingestion hub",          permission: "data.source.read",        group: "Data ingestion" },
  { key: "data",              label: "File uploads",           permission: "data.upload",             group: "Data ingestion" },
  { key: "connectors",        label: "Connections",            permission: "data.source.read",        group: "Data ingestion" },
  { key: "watchers",          label: "File watchers",          permission: "data.source.read",        group: "Data ingestion" },
  { key: "prep",              label: "Data Prep",              permission: "data.prep.read",          group: "Data ingestion" },
  { key: "aidp",              label: "AIDP",                   permission: "aidp.document.read",      group: "Data ingestion" },
  { key: "reference",         label: "Reference data",         permission: "reference.read",          group: "Data ingestion" },
  { key: "recons",            label: "ReconIQ Studio",           permission: "recon.definition.read",   group: "Reconcile" },
  { key: "schedules",         label: "Rekon Orchestrator",     permission: "recon.run.execute",       group: "Reconcile" },
  { key: "runs",              label: "Run history",            permission: "recon.definition.read",   group: "Reconcile" },
  { key: "templates",         label: "Starter Kits",           permission: "recon.definition.read",   group: "Reconcile" },
  { key: "collateral",        label: "Collateral / CSA",       permission: "recon.definition.read",   group: "Reconcile" },
  { key: "exception-dashboard", label: "Exceptions dashboard", permission: "break.read",              group: "Reconcile" },
  { key: "exceptions",        label: "Exception inbox",        permission: "break.read",              group: "Reconcile" },
  { key: "assignment",        label: "Auto-assignment",        permission: "break.assign",            group: "Reconcile" },
  { key: "breaks",            label: "Break manager",          permission: "break.read",              group: "Reconcile" },
  { key: "proposed",          label: "Proposed matches",       permission: "recon.match.approve",     group: "Reconcile" },
  { key: "matches",           label: "Matched records",        permission: "recon.definition.read",   group: "Reconcile" },
  { key: "nrl",               label: "Natural Rule Language",  permission: "recon.definition.update", group: "Reconcile" },
  { key: "manual-approvals",  label: "Manual match approvals", permission: "recon.match.approve",     group: "Reconcile" },
  { key: "ageing",            label: "Ageing",                 permission: "break.read",              group: "Insights" },
  { key: "reports",           label: "Reports",                permission: "recon.definition.read",   group: "Insights" },
  { key: "agent",             label: "Agent",                  permission: "ai.agent.run",            group: "Insights" },
  { key: "productivity",      label: "Productivity",           permission: "recon.definition.read",   group: "Insights" },
  { key: "eod",               label: "EOD sign-off",           permission: "signoff.submit",          group: "Governance" },
  { key: "membership-requests", label: "Request group access", permission: null,                      group: "Governance" },
  { key: "regulatory",        label: "Regulatory packs",       permission: "compliance.evidence.read",group: "Governance" },
  { key: "lineage",           label: "Data lineage",           permission: "data.lineage.read",       group: "Governance" },
  { key: "audit",             label: "Audit Trail",            permission: null,                      group: "Workspace" },
  { key: "tickets",           label: "Tickets",                permission: "support.ticket.read",     group: "Support" },
  { key: "kb",                label: "Knowledge",              permission: null,                      group: "Support" },
  { key: "access-explorer",   label: "Access explorer",        permission: null,                      group: "Support" },
];

export const TENANT_PAGES: PageDef[] = [
  // 1. Organization — who you are, who's in it, how they're branded
  { key: "settings",         label: "Settings",             permission: "tenant.settings.read",   group: "Organization" },
  { key: "members",          label: "Members",              permission: "tenant.user.read",       group: "Organization" },
  { key: "rbac-roles",       label: "Roles & Permissions",  permission: "tenant.role.read",       group: "Organization" },
  { key: "groups",           label: "Groups",               permission: "tenant.role.read",       group: "Organization" },
  { key: "domains",          label: "Domains & URLs",       permission: "tenant.domain.manage",   group: "Organization" },
  { key: "business-units",   label: "Business Units",       permission: "tenant.bu.read",         group: "Organization" },
  { key: "branding",         label: "Branding",             permission: "tenant.branding.update", group: "Organization" },
  { key: "people-analytics", label: "People analytics",     permission: "tenant.user.read",       group: "Organization" },
  { key: "access-explorer",  label: "Access explorer",      permission: "tenant.role.read",       group: "Organization" },
  { key: "governance",       label: "Requests & approvals", permission: "tenant.user.read",       group: "Organization" },

  // 2. Data & Integrations — how data enters and how systems connect
  { key: "connectors",       label: "Connectors",           permission: "data.source.read",       group: "Data & Integrations" },
  { key: "channels",         label: "Channels",             permission: "tenant.settings.update", group: "Data & Integrations" },
  { key: "sso",              label: "SSO",                  permission: "security.sso.configure", group: "Data & Integrations" },
  { key: "scim",             label: "SCIM provisioning",    permission: "tenant.user.invite",     group: "Data & Integrations" },
  { key: "webhooks",         label: "Webhooks",             permission: "webhook.manage",         group: "Data & Integrations" },
  { key: "chat-ops",         label: "Chat-Ops",             permission: "tenant.settings.update", group: "Data & Integrations" },
  { key: "gtm",              label: "API · Migration · Chat", permission: "tenant.settings.update", group: "Data & Integrations" },
  { key: "api-docs",         label: "API Reference",        permission: "api.token.read",         group: "Data & Integrations" },
  { key: "dev-platform",     label: "Developer Platform",   permission: "api.token.create",       group: "Data & Integrations" },
  { key: "pipeline-status",  label: "Pipeline status",      permission: "tenant.settings.read",   group: "Data & Integrations" },
  // 3. AI & Automation — configure, govern, and observe the AI surface
  { key: "ai",               label: "AI & LLM",             permission: "ai.model.configure",     group: "AI & Automation" },
  { key: "ai-gov",           label: "AI Governance",        permission: "ai.model.configure",     group: "AI & Automation" },
  { key: "ai-usage",         label: "AI Usage",             permission: "ai.budget.read",         group: "AI & Automation" },
  { key: "agent-policies",   label: "Agent policies",       permission: "ai.agent.configure",     group: "AI & Automation" },
  { key: "agent-review",     label: "Agent review queue",   permission: "ai.agent.run",           group: "AI & Automation" },
  { key: "aidp-review",      label: "AIDP review queue",    permission: "aidp.template.author",   group: "AI & Automation" },
  { key: "agent-workflows",  label: "Agent workflows",      permission: "ai.agent.configure",     group: "AI & Automation" },

  // 3a. Modules & Features — per-tenant product surface controls (entitlements, flags, page visibility)
  { key: "modules",          label: "Modules & Features",   permission: "tenant.settings.read",   group: "Modules & Features" },
  { key: "features",         label: "Feature flags",        permission: "tenant.settings.read",   group: "Modules & Features" },
  { key: "workspace-visibility", label: "Workspace pages", permission: "tenant.settings.update", group: "Modules & Features" },

  // 4. Reconciliation Ops — reporting, promotion, delivery of recon output
  { key: "reporting-map",    label: "Reporting fields",     permission: "tenant.settings.update", group: "Reconciliation Ops" },
  { key: "reporting-db",     label: "BI / Reporting DB",    permission: "tenant.settings.update", group: "Reconciliation Ops" },
  { key: "promo",            label: "Environment Delivery", permission: "recon.definition.publish", group: "Reconciliation Ops" },

  // 5. Compliance & Risk — security posture, keys, regulatory evidence, audit
  { key: "security",         label: "Security",             permission: "security.mfa.enforce",   group: "Compliance & Risk" },
  { key: "security-v2",      label: "Security Center",      permission: "security.mfa.enforce",   group: "Compliance & Risk" },
  { key: "vault",            label: "Vault (BYOK-KMS)",     permission: "security.byok.manage",   group: "Compliance & Risk" },
  { key: "byok",             label: "BYOK / HYOK",          permission: "security.byok.manage",   group: "Compliance & Risk" },
  { key: "cmek",             label: "CMEK keys",            permission: "security.byok.manage",   group: "Compliance & Risk" },
  { key: "dora",             label: "DORA (Art. 28)",       permission: "compliance.evidence.read", group: "Compliance & Risk" },
  { key: "subprocessors",    label: "Sub-processors",       permission: "tenant.settings.read",   group: "Compliance & Risk" },
  { key: "residency",        label: "Residency & DR",       permission: "tenant.settings.update", group: "Compliance & Risk" },
  { key: "retention",        label: "Data retention",       permission: "compliance.retention.manage", group: "Compliance & Risk" },
  { key: "ip-allowlist",     label: "IP allowlist",         permission: "security.mfa.enforce",   group: "Compliance & Risk" },
  { key: "dlp",              label: "DLP policies",         permission: "security.mfa.enforce",   group: "Compliance & Risk" },
  { key: "audit",            label: "Audit",                permission: "audit.log.read",         group: "Compliance & Risk" },

  // 6. Support & Success — user help, SLAs, plan usage
  { key: "kb",               label: "Knowledge",            permission: null,                     group: "Support & Success" },
  { key: "tickets",          label: "Tickets",              permission: "support.ticket.read",    group: "Support & Success" },
  { key: "sla",              label: "SLA",                  permission: "support.ticket.respond", group: "Support & Success" },
  { key: "usage-metering",   label: "Usage & Plan",         permission: "billing.read",           group: "Support & Success" },

  // 7. Resilience — streaming spine, DR, worker + recon health
  { key: "resilience",       label: "Resilience",           permission: "tenant.settings.read",   group: "Resilience" },
  { key: "streaming",        label: "Streaming spine",      permission: "tenant.settings.update", group: "Resilience" },
  { key: "recon-health",     label: "Recon health",         permission: "recon.definition.read",  group: "Resilience" },
  { key: "worker-health",    label: "Worker health",        permission: "tenant.settings.read",   group: "Resilience" },
];

/** Platform pages are reserved for platform admins; no per-permission gate. */
export const PLATFORM_PAGES_REQUIRE_PLATFORM_ADMIN = true;

export function findPageDef(scope: "workspace" | "tenant", key: string): PageDef | undefined {
  const list = scope === "workspace" ? WORKSPACE_PAGES : TENANT_PAGES;
  return list.find((p) => p.key === key);
}
