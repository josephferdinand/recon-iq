// Docs Hub registry.
// Uses Vite's import.meta.glob to bundle every markdown file under /docs
// as raw text, loaded lazily on demand.

const rawLoaders = import.meta.glob("/docs/**/*.md", {
  query: "?raw",
  import: "default",
}) as Record<string, () => Promise<string>>;

// slug === path relative to /docs, without trailing ".md"
// e.g. "runbooks/01_dr_restore"
function pathToSlug(path: string): string {
  return path.replace(/^\/docs\//, "").replace(/\.md$/, "");
}

export const ALL_DOC_SLUGS: string[] = Object.keys(rawLoaders)
  .map(pathToSlug)
  .sort();

export async function loadDocMarkdown(slug: string): Promise<string | null> {
  const key = `/docs/${slug}.md`;
  const loader = rawLoaders[key];
  if (!loader) return null;
  try {
    return await loader();
  } catch {
    return null;
  }
}

export function docExists(slug: string): boolean {
  return `/docs/${slug}.md` in rawLoaders;
}

export const DOC_VERSIONS = ["v4.0", "v3.0"] as const;
export type DocVersion = (typeof DOC_VERSIONS)[number];
export const DEFAULT_DOC_VERSION: DocVersion = "v4.0";
export const LATEST_DOC_VERSION: DocVersion = "v4.0";

export const DOC_VERSION_META: Record<DocVersion, {
  label: string;
  status: "latest" | "supported" | "deprecated";
  releaseDate: string;
  notesSlug?: string;
}> = {
  "v4.0": { label: "v4.0 · Current", status: "latest", releaseDate: "2026-Q2", notesSlug: "RELEASE_NOTES_v3" },
  "v3.0": { label: "v3.0 · Archived", status: "supported", releaseDate: "2025-Q4", notesSlug: "RELEASE_NOTES_v2" },
};

export function isDocVersion(v: string | undefined): v is DocVersion {
  return !!v && (DOC_VERSIONS as readonly string[]).includes(v);
}

export type DocEntry = {
  slug: string;
  title: string;
  description?: string;
  /**
   * Which versions expose this entry. Defaults to every version when omitted.
   * A version can also remap the source file via `sources`, useful when a v3
   * doc has a different filename than its v4 successor.
   */
  versions?: DocVersion[];
  sources?: Partial<Record<DocVersion, string>>;
};

export type DocCategory = {
  id: string;
  title: string;
  description: string;
  icon: string; // lucide icon name
  accent: string; // tailwind class fragment for tint
  entries: DocEntry[];
};

export function entryAvailableIn(entry: DocEntry, version: DocVersion): boolean {
  if (!entry.versions) return true;
  return entry.versions.includes(version);
}

export function entriesForVersion(cat: DocCategory, version: DocVersion): DocEntry[] {
  return cat.entries.filter((e) => entryAvailableIn(e, version));
}

export function resolveSourceSlug(entry: DocEntry, version: DocVersion): string {
  return entry.sources?.[version] ?? entry.slug;
}


// Curated, ordered table of contents. Only entries here appear in the hub;
// deep-links to any doc under /docs/**/*.md still work via the viewer.
export const DOC_CATEGORIES: DocCategory[] = [
  {
    id: "api",
    title: "API & Developer",
    description:
      "OpenAPI reference, endpoint contracts, authentication, SDK notes.",
    icon: "Code2",
    accent: "from-blue-500/10 to-cyan-500/10 border-blue-500/20",
    entries: [
      { slug: "openapi/README", title: "OpenAPI overview", description: "How the fvi-openapi.yaml is structured and consumed." },
      { slug: "04_api_reference", title: "REST API reference", description: "Canonical endpoint catalogue." },
      { slug: "85_developer_portal_api_docs", title: "Developer portal build notes", versions: ["v4.0"] },
      { slug: "86_sdk_generation", title: "TypeScript SDK generation", description: "How versioned SDKs are generated and published.", versions: ["v4.0"] },
      { slug: "87_sandbox_console", title: "API sandbox (try-it console)", description: "OAuth2 client-credentials + user-session powered sandbox.", versions: ["v4.0"] },
      { slug: "80_api_docs_build", title: "API docs pipeline", versions: ["v4.0"] },
      { slug: "architecture/11_api_documentation", title: "Server function inventory" },
      { slug: "architecture/appendix_h_server_function_inventory", title: "Appendix H — server functions" },
    ],
  },
  {
    id: "runbooks",
    title: "Operations Runbooks",
    description:
      "Step-by-step incident, DR, tenant lifecycle and platform recovery guides.",
    icon: "BookOpen",
    accent: "from-amber-500/10 to-orange-500/10 border-amber-500/20",
    entries: [
      { slug: "runbooks/README", title: "Runbook index" },
      { slug: "runbooks/01_dr_restore", title: "DR restore", description: "Cross-region restore procedure." },
      { slug: "runbooks/02_tenant_onboarding", title: "Tenant onboarding" },
      { slug: "runbooks/03_tenant_offboarding_purge", title: "Tenant offboarding & purge" },
      { slug: "runbooks/04_rls_incident", title: "RLS incident response" },
      { slug: "runbooks/05_cross_region_failover", title: "Cross-region failover" },
      { slug: "runbooks/06_byok_key_rotation", title: "BYOK key rotation" },
      { slug: "runbooks/07_incident_response_p1_p2", title: "P1 / P2 incident response" },
      { slug: "runbooks/08_siem_anomaly_triage", title: "SIEM anomaly triage" },
      { slug: "runbooks/09_backup_verification_weekly", title: "Weekly backup verification", versions: ["v4.0"] },
      { slug: "runbooks/10_erp_connector_sync_failure", title: "ERP connector sync failure", versions: ["v4.0"] },
      { slug: "51_backups_dr_runbook", title: "Backups & DR overview" },
      { slug: "06_runbooks", title: "Legacy runbook bundle", versions: ["v3.0"] },
    ],
  },
  {
    id: "admin",
    title: "Admin Guides",
    description:
      "Tenant admin & platform admin playbooks for RBAC, SSO, audit, retention, BYOK.",
    icon: "ShieldCheck",
    accent: "from-emerald-500/10 to-teal-500/10 border-emerald-500/20",
    entries: [
      { slug: "admin-guides/README", title: "Admin guides index" },
      { slug: "admin-guides/01_rbac_sod", title: "RBAC & segregation of duties" },
      { slug: "admin-guides/02_sso_saml", title: "SSO / SAML setup" },
      { slug: "admin-guides/03_ip_allowlist_zero_trust", title: "IP allowlist & zero-trust" },
      { slug: "admin-guides/04_audit_export", title: "Audit export" },
      { slug: "admin-guides/05_retention_residency", title: "Retention & residency" },
      { slug: "admin-guides/06_byok_llm", title: "BYOK LLM keys" },
      { slug: "admin-guides/07_support_escalation", title: "Support escalation" },
      { slug: "admin-guides/08_break_glass", title: "Break-glass access" },
      { slug: "45_platform_roles_admin_vs_member", title: "Platform roles: admin vs member" },
      { slug: "25_rbac_guide", title: "RBAC guide" },
      { slug: "48_mkt_admin_hardening", title: "Marketing admin hardening", versions: ["v4.0"] },
    ],
  },
  {
    id: "architecture",
    title: "Architecture & Data",
    description:
      "System context, containers, data flow, multi-tenant model, compliance mapping.",
    icon: "Layers",
    accent: "from-violet-500/10 to-purple-500/10 border-violet-500/20",
    entries: [
      { slug: "architecture/00_README", title: "Architecture index" },
      { slug: "architecture/01_high_level_architecture", title: "High-level architecture" },
      { slug: "architecture/02_low_level_architecture", title: "Low-level architecture" },
      { slug: "architecture/03_data_flow_diagrams", title: "Data flow diagrams" },
      { slug: "architecture/05_multi_tenant_design", title: "Multi-tenant design" },
      { slug: "architecture/06_security_architecture", title: "Security architecture" },
      { slug: "architecture/08_compliance_readiness", title: "Compliance readiness" },
      { slug: "architecture/12_ai_reconciliation_engine", title: "AI reconciliation engine" },
      { slug: "01_architecture_overview", title: "Architecture overview" },
      { slug: "02_database_schema", title: "Database schema" },
      { slug: "39_tenant_isolation", title: "Tenant isolation" },
    ],
  },
  {
    id: "security",
    title: "Security & Compliance",
    description:
      "Security posture, SOC 2 evidence, pen-test scope, responsible AI governance.",
    icon: "Lock",
    accent: "from-rose-500/10 to-pink-500/10 border-rose-500/20",
    entries: [
      { slug: "03_security_posture", title: "Security posture" },
      { slug: "77_soc2_evidence_bundles", title: "SOC 2 evidence bundles" },
      { slug: "52_soc2_audit_export", title: "SOC 2 audit export" },
      { slug: "security/pentest-sow", title: "Pen-test SOW" },
      { slug: "72_pentest_bugbounty_plan", title: "Pen-test & bug bounty plan" },
      { slug: "82_pentest_bugbounty_build", title: "Pen-test build" },
      { slug: "35_continuous_security_monitoring", title: "Continuous security monitoring" },
      { slug: "38_responsible_ai_governance", title: "Responsible AI governance" },
      { slug: "44_vault_delivery", title: "Vault delivery" },
      { slug: "19_retention_policy", title: "Retention policy" },
      { slug: "15_regulatory_packs", title: "Regulatory packs" },
    ],
  },
  {
    id: "observability",
    title: "Observability & Ops",
    description:
      "APM / SIEM pipeline, SLOs, detections, release automation, CI gates.",
    icon: "Activity",
    accent: "from-sky-500/10 to-indigo-500/10 border-sky-500/20",
    entries: [
      { slug: "81_observability_build", title: "Observability build" },
      { slug: "75_apm_siem_pipeline", title: "APM + SIEM pipeline" },
      { slug: "71_observability_apm_siem_plan", title: "Observability plan" },
      { slug: "observability/slo", title: "Service level objectives" },
      { slug: "20_release_automation", title: "Release automation" },
      { slug: "20_disaster_recovery", title: "Disaster recovery" },
      { slug: "13_ci_gates", title: "CI gates" },
      { slug: "17_ops_health_and_onboarding", title: "Ops health & onboarding" },
      { slug: "22_status_page", title: "Status page" },
    ],
  },
  {
    id: "diagrams",
    title: "Diagrams",
    description:
      "Rendered SVG / PNG architecture and workflow diagrams. Sources under docs/diagrams/*.mmd.",
    icon: "Network",
    accent: "from-fuchsia-500/10 to-purple-500/10 border-fuchsia-500/20",
    entries: [
      { slug: "diagrams/README", title: "Diagram index" },
      { slug: "19_diagram_drift_gate", title: "Diagram drift gate" },
    ],
  },
  {
    id: "release",
    title: "Release & Governance",
    description:
      "Change logs, release notes, certification packages, governance frameworks.",
    icon: "GitBranch",
    accent: "from-lime-500/10 to-green-500/10 border-lime-500/20",
    entries: [
      { slug: "CHANGELOG_v2", title: "Changelog v2", versions: ["v3.0"] },
      { slug: "RELEASE_NOTES_v2", title: "Release notes v2", versions: ["v3.0"] },
      { slug: "RELEASE_NOTES_v3", title: "Release notes v3", versions: ["v4.0"] },
      { slug: "40_final_release_package", title: "Final release package", versions: ["v4.0"] },
      { slug: "42_final_certification_package", title: "Final certification package" },
      { slug: "36_final_certification", title: "Final certification" },
      { slug: "support-portal-governance", title: "Support portal governance" },
      { slug: "AUDIT_EXPORT_MANIFEST", title: "Audit export manifest" },
      { slug: "DOCS_QA_CHECKLIST", title: "Docs QA checklist" },
    ],
  },
];

export function searchDocs(query: string, version: DocVersion = DEFAULT_DOC_VERSION): DocEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const seen = new Set<string>();
  const results: DocEntry[] = [];
  for (const cat of DOC_CATEGORIES) {
    for (const e of cat.entries) {
      if (!entryAvailableIn(e, version)) continue;
      if (seen.has(e.slug)) continue;
      const hay = `${e.title} ${e.description ?? ""} ${e.slug}`.toLowerCase();
      if (hay.includes(q)) {
        seen.add(e.slug);
        results.push(e);
      }
    }
  }
  for (const slug of ALL_DOC_SLUGS) {
    if (seen.has(slug)) continue;
    if (slug.toLowerCase().includes(q)) {
      seen.add(slug);
      results.push({ slug, title: slug });
    }
  }
  return results.slice(0, 40);
}

export function findCategoryForSlug(slug: string): DocCategory | null {
  for (const cat of DOC_CATEGORIES) {
    if (cat.entries.some((e) => e.slug === slug)) return cat;
  }
  return null;
}

export function findEntry(slug: string): DocEntry | null {
  for (const cat of DOC_CATEGORIES) {
    const hit = cat.entries.find((e) => e.slug === slug);
    if (hit) return hit;
  }
  return null;
}

