/** Source mapping only. Parent must reconcile enabled functions against each
 * actual cell's capabilities before registering them as deployed/monitored. */
export const STATUS_SOURCE_FUNCTIONS = [
  { component: "auth", key: "identity.sign_in", label: "Sign in and MFA", source: "src/routes/auth.tsx" },
  { component: "workspace", key: "workspace.home", label: "Workspace and access", source: "src/routes/_authenticated/home.tsx" },
  { component: "workspace", key: "directory.organisation", label: "Directory and organisation", source: "src/lib/access.functions.ts" },
  { component: "recon", key: "reconciliation.run", label: "Reconciliation execution", source: "src/lib/recon-orchestrator.server.ts" },
  { component: "recon", key: "reconciliation.results", label: "Run results and history", source: "src/lib/recon-run-detail.functions.ts" },
  { component: "recon", key: "reconciliation.exceptions", label: "Exception management", source: "src/lib/exception-dashboard.functions.ts" },
  { component: "connectors", key: "data.preparation", label: "Data preparation", source: "src/lib/data-prep.functions.ts" },
  { component: "connectors", key: "data.ingestion", label: "Sources and connectors", source: "src/lib/data-sources.functions.ts" },
  { component: "recon", key: "scheduling.jobs", label: "Schedules and recovery", source: "src/lib/recon-schedules.functions.ts" },
  { component: "aidp", key: "documents.processing", label: "Document processing", source: "src/lib/aidp.functions.ts" },
  { component: "reporting", key: "reports.exports", label: "Reporting and exports", source: "src/lib/reports.functions.ts" },
  { component: "workspace", key: "governance.membership", label: "Membership approvals", source: "src/lib/governance-membership.functions.ts" },
  { component: "api", key: "api.enterprise", label: "Enterprise APIs", source: "src/routes/api/public/status[.]json.ts" },
  { component: "workspace", key: "governance.access_review", label: "Access reviews", source: "src/lib/governance-access-review.functions.ts" },
  { component: "workspace", key: "governance.audit", label: "Audit trail", source: "src/lib/governance-audit.functions.ts" },
  { component: "workspace", key: "recovery.backup", label: "Backup and recovery", source: "src/lib/platform-backup.functions.ts" },
  { component: "recon", key: "templates.reconciliation", label: "Reconciliation templates", source: "src/lib/recon-templates.functions.ts" },
  { component: "reporting", key: "collateral.lifecycle", label: "Collateral lifecycle", source: "src/lib/collateral-csa.functions.ts" },
  { component: "api", key: "copilot.suggest", label: "Governed Copilot suggestions", source: "src/lib/copilot-tools.server.ts" },
  { component: "email", key: "notifications.delivery", label: "Transactional delivery", source: "src/lib/email-templates/zeptomail.ts" },
] as const;
