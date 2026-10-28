/**
 * Support Portal Table of Contents — single source of truth.
 * Each article contains structured content grounded in real ReconIQ capabilities.
 * Architecture: category → articles; 1000+ scale without restructuring.
 */

// LL-016 follow-up: rolldown collapses `init_support_toc` to `(() => {})` when
// this module has no top-level side effects, which then crashes route
// registration with "init_support_toc is not a function" once a route chunk
// imports this module transitively across the router-1 ↔ router-2 cyclic
// edge. A real statement with an observable side effect (assignment to a
// module-scoped binding) forces rolldown to emit a non-empty init body and
// orders this module's evaluation before the route's __esmMin closes.
const __supportTocModuleMarker = 1;
void __supportTocModuleMarker;

export interface Article {
  slug: string;
  title: string;
  summary: string;
  seoTitle: string;
  seoDescription: string;
  tags: string[];
  readTime: number;
  relatedSlugs?: string[];
  sections: ArticleSection[];
  faq?: { q: string; a: string }[];
}

export interface ArticleSection {
  heading?: string;
  body: string;
  callout?: { type: "info" | "warning" | "tip"; text: string };
  steps?: string[];
  code?: { lang: string; code: string };
}

export interface Category {
  slug: string;
  name: string;
  icon: string;
  description: string;
  articles: Article[];
}

// Why no `export const SUPPORT_CATEGORIES`? — see LL-016.
// This module sits on a cyclic bundler edge between the sitemap route
// (router-1) and the support category/article routes (router-2). When a
// top-level `export const X = [...]` reaches rolldown it gets split into a
// `var X; var init_X = __esmMin(() => { X = [...] })` pair so the value can
// be lazily initialized once the cyclic edge resolves. Across the edge, the
// importing module sees `X` as `undefined` until `init_X()` runs — which
// never happens during route registration because that registration is
// itself what triggers the cycle. Hoisted function declarations avoid the
// wrapper entirely, so we expose the data only via `getSupportCategories()`.
function buildSupportCategories(): Category[] {
  return [
  // ───────────────────────────────────────────────────────────────
  // 1. Getting Started
  // ───────────────────────────────────────────────────────────────
  {
    slug: "getting-started",
    name: "Getting Started",
    icon: "rocket",
    description: "Everything you need to get up and running with ReconIQ's reconciliation platform.",
    articles: [
      {
        slug: "what-is-fvi",
        title: "What is ReconIQ?",
        summary: "An introduction to ReconIQ — the AI-native reconciliation platform for financial institutions.",
        seoTitle: "What is ReconIQ? | AI-Native Reconciliation Platform",
        seoDescription: "ReconIQ is an enterprise-grade, AI-native SaaS platform transforming reconciliation for financial institutions and large banks worldwide.",
        tags: ["overview", "introduction", "platform"],
        readTime: 4,
        sections: [
          {
            body: "ReconIQ is an enterprise-grade, AI-native SaaS platform built to transform reconciliation processes for financial institutions and large banks worldwide. Unlike bolt-on AI add-ons, ReconIQ was designed with artificial intelligence at its core — delivering a fundamentally advanced and intelligent approach to reconciliation.",
          },
          {
            heading: "Core Capabilities",
            body: "ReconIQ supports a wide range of reconciliation needs:",
            steps: [
              "One-sided reconciliation — match internal ledgers against expected values",
              "Two-sided reconciliation — compare two data sources and identify breaks",
              "Tri-party reconciliation — reconcile across three parties such as custodians, prime brokers, and internal books",
            ],
          },
          {
            heading: "AI Copilot & Agentic Workflows",
            body: "ReconIQ features an integrated AI Copilot providing real-time insights, intelligent automation, and seamless interaction. The agentic AI capabilities automate break resolution, propose matches, and learn from your team's decisions.",
            callout: { type: "tip", text: "The AI Copilot can surface the root cause of a break in seconds — what used to take hours of manual investigation." },
          },
          {
            heading: "Deployment Options",
            body: "ReconIQ offers flexible deployment including cloud-hosted, bring-your-own LLM keys, and robust tenant isolation. World-class security and data privacy standards are embedded across the platform.",
          },
        ],
        faq: [
          { q: "Is ReconIQ a background verification platform?", a: "No. ReconIQ is a reconciliation platform for financial operations. It matches, reconciles, and resolves breaks across data sources — it does not perform background checks or employment screening." },
          { q: "Can ReconIQ handle multiple asset classes?", a: "Yes. ReconIQ supports equities, fixed income, derivatives, fund NAV, collateral, FX, and more via configurable reconciliation definitions." },
        ],
      },
      {
        slug: "platform-overview",
        title: "Platform Overview",
        summary: "Explore ReconIQ's architecture: workspaces, tenants, reconciliation engine, AI Copilot, and governance layers.",
        seoTitle: "ReconIQ — Platform Architecture & Components",
        seoDescription: "Understand ReconIQ's multi-tenant architecture, reconciliation engine, AI Copilot, and enterprise governance layers.",
        tags: ["architecture", "tenants", "engine"],
        readTime: 6,
        sections: [
          {
            body: "ReconIQ is architected for enterprise-scale reconciliation with strict tenant isolation, role-based access, and auditability at every layer.",
          },
          {
            heading: "Multi-Tenant Architecture",
            body: "Each organization operates within an isolated tenant. Platform administrators can manage multiple tenants (e.g., for different business units or geographies) while maintaining strict data separation. Workspaces further segment work within a tenant.",
          },
          {
            heading: "Reconciliation Engine",
            body: "The core engine ingests data sources, applies matching rules (tolerance ladders, cascades, NRL), produces matches, and surfaces breaks. Runs are scheduled or on-demand.",
          },
          {
            heading: "AI Copilot",
            body: "The Copilot answers questions about breaks, proposes resolutions, and summarizes run results. It integrates with the knowledge base and can trigger agentic actions.",
          },
          {
            heading: "Governance & Compliance",
            body: "End-of-day signoffs, audit log hash-chaining, SOC 2 evidence bundles, DORA compliance, and configurable retention policies ensure enterprise-grade governance.",
          },
        ],
      },
      {
        slug: "account-setup",
        title: "Account Setup",
        summary: "Create your ReconIQ account, verify your email, and complete initial profile setup.",
        seoTitle: "ReconIQ Account Setup Guide",
        seoDescription: "Step-by-step instructions to create and configure your ReconIQ account.",
        tags: ["account", "signup", "profile"],
        readTime: 3,
        sections: [
          {
            heading: "Sign Up",
            body: "Navigate to app.reconiq.example and click Sign Up. Enter your work email and set a strong password.",
            steps: ["Go to https://app.reconiq.example/auth", "Enter work email", "Create a password (min 12 chars, one number, one symbol)", "Submit and check email for verification link"],
            callout: { type: "info", text: "If your organization uses SSO (SAML), your admin will provide a direct login link." },
          },
          {
            heading: "Verify Email",
            body: "Click the verification link sent to your inbox. If you don't see it, check spam or request a new link from the sign-in page.",
          },
          {
            heading: "Complete Profile",
            body: "After verification, complete your profile: display name, timezone, and notification preferences. These settings can be changed later.",
          },
        ],
      },
      {
        slug: "user-roles",
        title: "User Roles & Permissions",
        summary: "Understand ReconIQ's role-based access control: platform admins, tenant admins, workspace members, and custom roles.",
        seoTitle: "ReconIQ User Roles & RBAC Guide",
        seoDescription: "Learn about ReconIQ's role-based access control system including platform admins, tenant admins, and workspace roles.",
        tags: ["rbac", "roles", "permissions"],
        readTime: 5,
        sections: [
          {
            heading: "Role Hierarchy",
            body: "ReconIQ uses a hierarchical RBAC model:",
            steps: [
              "Platform Super Admin — manages platform-wide settings, billing, and tenant creation",
              "Platform Admin — views cross-tenant metrics and audit logs",
              "Tenant Admin — manages a single tenant: users, workspaces, integrations",
              "Workspace Admin — manages recon definitions, data sources, and workspace members",
              "Operator — runs reconciliations, resolves breaks, signs off on runs",
              "Viewer — read-only access to dashboards and reports",
            ],
          },
          {
            heading: "Assigning Roles",
            body: "Tenant admins assign roles via Settings → Users & Roles. Each user can hold multiple roles across workspaces.",
            callout: { type: "warning", text: "Roles are stored in a dedicated table — never in the profile — to prevent privilege escalation." },
          },
        ],
      },
      {
        slug: "first-recon-run",
        title: "Your First Reconciliation Run",
        summary: "Upload data sources, configure a recon definition, and execute your first run.",
        seoTitle: "First Reconciliation Run in ReconIQ",
        seoDescription: "A step-by-step guide to running your first reconciliation in ReconIQ.",
        tags: ["quickstart", "recon", "tutorial"],
        readTime: 7,
        sections: [
          {
            heading: "Prepare Data Sources",
            body: "Gather your two source files (e.g., internal ledger CSV and custodian statement). Ensure they share a common key (e.g., trade ID).",
          },
          {
            heading: "Upload Sources",
            body: "In your workspace, go to Data Sources → Upload. Drag and drop each file and map columns via the preview wizard.",
            steps: ["Open Data Sources", "Click Upload", "Drag your file", "Map columns (key, quantity, price, etc.)", "Save"],
          },
          {
            heading: "Create Recon Definition",
            body: "Go to Reconciliations → New Definition. Name it, select the two sources, choose matching keys, and set tolerance thresholds.",
          },
          {
            heading: "Execute Run",
            body: "Click Run Now. ReconIQ ingests, matches, and produces a run result. Review matched, unmatched, and break rows in the Run Results panel.",
            callout: { type: "tip", text: "Use the AI Copilot button to ask questions about any break — it will explain probable root causes." },
          },
        ],
        faq: [
          { q: "Can I schedule recurring runs?", a: "Yes. Create a schedule under Schedules → New. Choose frequency (daily, hourly, etc.) and optional market-calendar awareness." },
        ],
      },
      {
        slug: "quick-start-guide",
        title: "Quick Start Guide",
        summary: "A condensed checklist to go live with ReconIQ in under an hour.",
        seoTitle: "ReconIQ Quick Start Checklist",
        seoDescription: "Get live with ReconIQ in under an hour using this quick start checklist.",
        tags: ["quickstart", "checklist"],
        readTime: 3,
        sections: [
          {
            body: "Use this checklist to go live fast:",
            steps: [
              "Sign up and verify email",
              "Complete profile",
              "Create or join a tenant",
              "Create a workspace",
              "Upload two data sources",
              "Create a recon definition",
              "Run the reconciliation",
              "Review breaks and matches",
              "Ask the AI Copilot for insights",
              "Export or sign off on results",
            ],
          },
        ],
      },
    ],
  },

  // ───────────────────────────────────────────────────────────────
  // 2. Product Documentation
  // ───────────────────────────────────────────────────────────────
  {
    slug: "product",
    name: "Product Documentation",
    icon: "book-open",
    description: "In-depth guides for every feature: dashboard, reconciliations, breaks, matches, AI Copilot, and more.",
    articles: [
      {
        slug: "dashboard",
        title: "Dashboard Overview",
        summary: "Understand your home dashboard: KPIs, recent runs, break trends, and AI suggestions.",
        seoTitle: "ReconIQ Dashboard Overview",
        seoDescription: "Learn how to read and customize your ReconIQ home dashboard.",
        tags: ["dashboard", "kpis", "overview"],
        readTime: 4,
        sections: [
          { body: "The dashboard surfaces key metrics: open breaks, recent runs, match rate trends, SLA timers, and AI-recommended actions." },
          { heading: "KPI Cards", body: "Total open breaks, average resolution time, match rate %, and runs completed today." },
          { heading: "Trend Charts", body: "View break volume over time, match accuracy, and SLA adherence." },
          { heading: "Customization", body: "Drag widgets to reorder. Click the gear icon to hide or show panels.", callout: { type: "tip", text: "Pin high-priority recon definitions to the dashboard for one-click run access." } },
        ],
      },
      {
        slug: "recon-definitions",
        title: "Reconciliation Definitions",
        summary: "Create, edit, and version recon definitions that drive your matching logic.",
        seoTitle: "ReconIQ Reconciliation Definitions Guide",
        seoDescription: "Master reconciliation definitions: matching keys, tolerance ladders, cascades, and versioning.",
        tags: ["definitions", "matching", "rules"],
        readTime: 8,
        sections: [
          { body: "A recon definition specifies which sources to compare, which fields to match, and how tolerances apply." },
          { heading: "Matching Keys", body: "Define primary and secondary keys (e.g., trade ID, ISIN + settlement date). ReconIQ hashes these to pair rows." },
          { heading: "Tolerance Ladders", body: "Set absolute or percentage thresholds for numeric fields. Rows within tolerance match; outside tolerance become breaks." },
          { heading: "Cascades", body: "Configure multi-pass matching: exact → fuzzy → rule-based. Each pass runs in order until a match is found." },
          { heading: "Versioning", body: "Every edit creates a new version. Roll back to any prior version under Definition → History." },
        ],
      },
      {
        slug: "breaks",
        title: "Understanding Breaks",
        summary: "What is a break, how ReconIQ categorizes them, and how to resolve.",
        seoTitle: "ReconIQ Break Management Guide",
        seoDescription: "Learn how ReconIQ surfaces, categorizes, and helps resolve reconciliation breaks.",
        tags: ["breaks", "exceptions", "resolution"],
        readTime: 6,
        sections: [
          { body: "A break occurs when two rows fail to match within tolerance or when a row appears in only one source." },
          { heading: "Break Types", body: "Value break (mismatch), Missing on Side A, Missing on Side B, Duplicate, Tolerance exceeded." },
          { heading: "Break Categories", body: "Assign business-meaning categories (e.g., Trade Date Error, Quantity Discrepancy) to drive workflows and analytics." },
          { heading: "AI-Suggested Resolution", body: "The AI Copilot analyzes break patterns and proposes likely root causes. Click Accept or override with a manual note." },
        ],
      },
      {
        slug: "matches",
        title: "Matches & Proposed Matches",
        summary: "Review confirmed matches, manual overrides, and AI-proposed matches awaiting approval.",
        seoTitle: "ReconIQ Matches & Proposed Matches",
        seoDescription: "Understand ReconIQ's matching lifecycle: auto-matches, proposed matches, and approvals.",
        tags: ["matches", "approvals", "manual"],
        readTime: 5,
        sections: [
          { body: "Rows that pass all matching criteria become confirmed matches. Rows that pass fuzzy criteria may become proposed matches requiring human approval." },
          { heading: "Manual Matching", body: "Select two unmatched rows and click Link to override the engine's decision. An audit trail records the user and reason." },
          { heading: "Approval Workflow", body: "Proposed matches appear in the Approvals queue. Approve or reject with a note. Approved rows become confirmed matches." },
        ],
      },
      {
        slug: "ai-copilot",
        title: "AI Copilot",
        summary: "Chat with the AI Copilot to investigate breaks, summarize runs, and automate workflows.",
        seoTitle: "ReconIQ AI Copilot Guide",
        seoDescription: "Learn how to use ReconIQ's AI Copilot for break investigation, run summaries, and agentic automation.",
        tags: ["ai", "copilot", "chat"],
        readTime: 6,
        sections: [
          { body: "The AI Copilot is integrated throughout ReconIQ. Click the Copilot button or use the command palette to ask questions." },
          { heading: "Example Prompts", body: "Try: 'Why is trade 12345 a break?' or 'Summarize yesterday's run' or 'List all breaks older than 5 days'." },
          { heading: "Agentic Actions", body: "The Copilot can propose bulk resolutions, create tasks, and escalate to Slack/Teams. Approve actions before they execute." },
          { heading: "Personas", body: "Platform admins can configure Copilot personas (e.g., Compliance Bot, Ops Analyst) with different knowledge scopes." },
        ],
      },
      {
        slug: "data-sources",
        title: "Data Sources & Ingestion",
        summary: "Upload files, connect databases, configure parsers, and schedule ingestion.",
        seoTitle: "ReconIQ Data Sources & Ingestion",
        seoDescription: "Configure data sources in ReconIQ: file upload, database connectors, API feeds, and parser definitions.",
        tags: ["data", "ingestion", "connectors"],
        readTime: 7,
        sections: [
          { heading: "File Upload", body: "Drag and drop CSV, Excel, or fixed-width files. ReconIQ auto-detects delimiters and maps columns." },
          { heading: "Database Connectors", body: "Connect to Postgres, SQL Server, Oracle, Snowflake, etc. Provide connection string or use secrets vault." },
          { heading: "API Feeds", body: "Configure REST or SFTP endpoints. Schedule polling or push via webhook." },
          { heading: "Parser Definitions", body: "For complex formats (SWIFT, ISO 20022, proprietary), define a parser with field maps. Reuse across sources." },
        ],
      },
      {
        slug: "schedules",
        title: "Schedules & Automation",
        summary: "Automate reconciliation runs with cron schedules, market calendars, and event triggers.",
        seoTitle: "ReconIQ Schedules & Automation",
        seoDescription: "Schedule reconciliation runs in ReconIQ: cron, market calendars, and event-driven triggers.",
        tags: ["schedules", "cron", "automation"],
        readTime: 5,
        sections: [
          { heading: "Cron Schedules", body: "Define daily, hourly, or custom cron expressions. View next-run preview." },
          { heading: "Market Calendars", body: "Skip runs on market holidays. ReconIQ ships with global market calendars (NYSE, LSE, HKEX, etc.)." },
          { heading: "Event Triggers", body: "Trigger runs when a file lands in SFTP or when an upstream system posts a webhook." },
        ],
      },
      {
        slug: "reports",
        title: "Reports & Exports",
        summary: "Generate PDF, Excel, and CSV reports. Schedule email delivery or download on demand.",
        seoTitle: "ReconIQ Reports & Exports",
        seoDescription: "Create and export reconciliation reports in ReconIQ: PDF, Excel, CSV, and scheduled email delivery.",
        tags: ["reports", "exports", "pdf"],
        readTime: 4,
        sections: [
          { body: "Generate run-level or aggregate reports. Include matched, unmatched, and break details." },
          { heading: "Export Formats", body: "PDF (branded), Excel (pivot-ready), CSV (raw)." },
          { heading: "Scheduled Delivery", body: "Email reports daily to stakeholders. Configure recipients per schedule." },
        ],
      },
    ],
  },

  // ───────────────────────────────────────────────────────────────
  // 3. Workflows
  // ───────────────────────────────────────────────────────────────
  {
    slug: "workflows",
    name: "Workflow Guides",
    icon: "git-branch",
    description: "End-to-end workflows for common reconciliation scenarios.",
    articles: [
      {
        slug: "daily-ops-workflow",
        title: "Daily Operations Workflow",
        summary: "The standard daily reconciliation cycle: ingest, run, review, resolve, sign off.",
        seoTitle: "ReconIQ Daily Operations Workflow",
        seoDescription: "Step-by-step guide to the daily reconciliation cycle in ReconIQ.",
        tags: ["daily", "ops", "signoff"],
        readTime: 6,
        sections: [
          { body: "A typical day: data lands overnight, scheduled runs execute, ops teams review breaks, resolve or escalate, and sign off before COB." },
          { heading: "Morning Review", body: "Check dashboard for overnight run status. Investigate any failed runs." },
          { heading: "Break Triage", body: "Sort breaks by age, SLA, or category. Assign to team members." },
          { heading: "Resolution", body: "Resolve breaks: accept proposed match, amend source data, or escalate to counterparty." },
          { heading: "Signoff", body: "Once all critical breaks are resolved, perform end-of-day signoff. This locks the run and generates an audit record." },
        ],
      },
      {
        slug: "exception-management",
        title: "Exception Management Workflow",
        summary: "Manage aged breaks, escalation paths, and SLA compliance.",
        seoTitle: "ReconIQ Exception Management Workflow",
        seoDescription: "Manage reconciliation exceptions: SLA timers, escalation rules, and ageing analysis.",
        tags: ["exceptions", "sla", "escalation"],
        readTime: 5,
        sections: [
          { heading: "SLA Timers", body: "ReconIQ tracks time-to-resolution per break. Breaches trigger alerts." },
          { heading: "Escalation Rules", body: "Configure auto-escalation: after N hours, notify manager or Slack channel." },
          { heading: "Ageing Reports", body: "View breaks by age bucket (0–1 day, 1–3 days, 3+ days). Prioritize oldest." },
        ],
      },
      {
        slug: "month-end-close",
        title: "Month-End Close Workflow",
        summary: "Reconciliation tasks for month-end: freeze data, final signoffs, evidence packs.",
        seoTitle: "ReconIQ Month-End Close Workflow",
        seoDescription: "Complete your month-end reconciliation close with ReconIQ: freeze, signoff, and evidence.",
        tags: ["month-end", "close", "audit"],
        readTime: 5,
        sections: [
          { body: "Month-end adds extra rigor: freeze data sources, resolve all material breaks, generate signoff evidence." },
          { heading: "Data Freeze", body: "Lock data sources at COB on last business day. No late amendments." },
          { heading: "Final Signoffs", body: "Require manager countersignature for month-end runs." },
          { heading: "Evidence Packs", body: "Export SOC 2-ready evidence bundles for external audit." },
        ],
      },
    ],
  },

  // ───────────────────────────────────────────────────────────────
  // 4. Security & Compliance
  // ───────────────────────────────────────────────────────────────
  {
    slug: "security",
    name: "Security & Compliance",
    icon: "shield-check",
    description: "ReconIQ's security architecture, compliance certifications, and data privacy controls.",
    articles: [
      {
        slug: "security-overview",
        title: "Security Overview",
        summary: "ReconIQ's defense-in-depth security model: encryption, isolation, and access controls.",
        seoTitle: "ReconIQ Security Overview",
        seoDescription: "Learn about ReconIQ's enterprise security: encryption at rest and in transit, tenant isolation, and access controls.",
        tags: ["security", "encryption", "isolation"],
        readTime: 5,
        sections: [
          { body: "ReconIQ is built with security as a first-class concern. All data is encrypted at rest (AES-256) and in transit (TLS 1.3). Tenant isolation is enforced at the database and application layers." },
          { heading: "Access Controls", body: "RBAC, SSO (SAML 2.0), MFA, and IP allowlisting." },
          { heading: "Audit Logging", body: "Every action is logged with hash-chained audit entries. Logs are immutable and exportable." },
        ],
      },
      {
        slug: "soc2",
        title: "SOC 2 Compliance",
        summary: "How ReconIQ supports SOC 2 Type II evidence collection and audit readiness.",
        seoTitle: "ReconIQ SOC 2 Compliance Guide",
        seoDescription: "ReconIQ's SOC 2 Type II evidence bundles, control mappings, and audit support.",
        tags: ["soc2", "audit", "compliance"],
        readTime: 4,
        sections: [
          { body: "ReconIQ provides built-in controls and evidence packs aligned to SOC 2 Trust Service Criteria." },
          { heading: "Evidence Bundles", body: "Generate on-demand evidence: access reviews, change management logs, incident records." },
          { heading: "Control Mapping", body: "View how ReconIQ features map to SOC 2 controls in Settings → Compliance." },
        ],
      },
      {
        slug: "gdpr",
        title: "GDPR & Data Privacy",
        summary: "ReconIQ's GDPR controls: data residency, retention, erasure, and DPA.",
        seoTitle: "ReconIQ GDPR & Data Privacy",
        seoDescription: "ReconIQ's GDPR compliance: data residency options, retention policies, right to erasure, and DPA.",
        tags: ["gdpr", "privacy", "dpa"],
        readTime: 4,
        sections: [
          { heading: "Data Residency", body: "Choose EU, US, or APAC hosting. Data never leaves the selected region." },
          { heading: "Retention Policies", body: "Configure per-tenant retention periods. Automated purge enforces limits." },
          { heading: "Right to Erasure", body: "Submit erasure requests via API or admin console. ReconIQ purges all PII within 30 days." },
        ],
      },
      {
        slug: "audit-logs",
        title: "Audit Logs",
        summary: "Immutable, hash-chained audit logs for every user and system action.",
        seoTitle: "ReconIQ Audit Logs Guide",
        seoDescription: "Explore ReconIQ's immutable audit log: hash-chaining, search, export, and SIEM integration.",
        tags: ["audit", "logs", "siem"],
        readTime: 4,
        sections: [
          { body: "Every action in ReconIQ generates an audit entry: who, what, when, and before/after state." },
          { heading: "Hash-Chaining", body: "Each entry includes a hash of the previous entry. Tampering is detectable." },
          { heading: "Search & Export", body: "Filter by user, action, resource. Export to CSV or stream to SIEM." },
        ],
      },
    ],
  },

  // ───────────────────────────────────────────────────────────────
  // 5. API Documentation
  // ───────────────────────────────────────────────────────────────
  {
    slug: "api",
    name: "API Documentation",
    icon: "code",
    description: "REST API reference, authentication, webhooks, SDKs, and sandbox.",
    articles: [
      {
        slug: "authentication",
        title: "API Authentication",
        summary: "Authenticate with API tokens or OAuth 2.0. Manage scopes and rotate keys.",
        seoTitle: "ReconIQ API Authentication",
        seoDescription: "Authenticate to ReconIQ's REST API using API tokens or OAuth 2.0.",
        tags: ["api", "auth", "oauth"],
        readTime: 4,
        sections: [
          { heading: "API Tokens", body: "Generate a token in Settings → API Tokens. Include in the Authorization header: `Bearer <token>`." },
          { heading: "OAuth 2.0", body: "Use client credentials flow for server-to-server. Authorization code flow for user-delegated access." },
          { heading: "Scopes", body: "Tokens can be scoped: read:recons, write:recons, read:breaks, admin, etc." },
        ],
      },
      {
        slug: "api-reference",
        title: "API Reference",
        summary: "Full REST API reference: endpoints, request/response schemas, error codes.",
        seoTitle: "ReconIQ API Reference",
        seoDescription: "Complete REST API reference for ReconIQ: endpoints, schemas, and examples.",
        tags: ["api", "reference", "rest"],
        readTime: 10,
        sections: [
          { body: "Base URL: `https://api.reconiq.example/v1`. All requests require authentication." },
          { heading: "Core Resources", body: "Tenants, Workspaces, Recon Definitions, Runs, Breaks, Matches, Data Sources, Users." },
          { heading: "Example: List Breaks", body: "GET `/v1/workspaces/{ws}/breaks?status=open`", code: { lang: "bash", code: "curl -H 'Authorization: Bearer $TOKEN' 'https://api.reconiq.example/v1/workspaces/abc/breaks?status=open'" } },
        ],
      },
      {
        slug: "webhooks",
        title: "Webhooks",
        summary: "Receive real-time events: run completed, break created, signoff completed.",
        seoTitle: "ReconIQ Webhooks Guide",
        seoDescription: "Configure webhooks in ReconIQ to receive real-time events for runs, breaks, and signoffs.",
        tags: ["webhooks", "events", "realtime"],
        readTime: 5,
        sections: [
          { heading: "Configure Webhooks", body: "Settings → Webhooks → Add Endpoint. Provide URL and select events." },
          { heading: "Event Types", body: "run.completed, break.created, break.resolved, signoff.completed, data_source.ingested." },
          { heading: "Security", body: "ReconIQ signs payloads with HMAC-SHA256. Verify the X-FVI-Signature header." },
        ],
      },
      {
        slug: "sdks",
        title: "SDKs & Libraries",
        summary: "Official SDKs for Python, Node.js, and .NET. Community libraries and Postman collection.",
        seoTitle: "ReconIQ SDKs & Libraries",
        seoDescription: "Official ReconIQ SDKs for Python, Node.js, .NET, and Postman collection.",
        tags: ["sdk", "libraries", "postman"],
        readTime: 3,
        sections: [
          { heading: "Python SDK", body: "`pip install reconiq-sdk`. Docs at github.com/josephferdinand/recon-iq." },
          { heading: "Node.js SDK", body: "`npm install @reconiq/sdk`. Supports TypeScript." },
          { heading: "Postman Collection", body: "Import from Developer Portal → Postman. Pre-configured environments for sandbox and production." },
        ],
      },
      {
        slug: "sandbox",
        title: "Sandbox Environment",
        summary: "Test integrations in the sandbox without affecting production data.",
        seoTitle: "ReconIQ Sandbox Environment",
        seoDescription: "Use ReconIQ's sandbox to test integrations, webhooks, and API calls safely.",
        tags: ["sandbox", "testing", "dev"],
        readTime: 3,
        sections: [
          { body: "The sandbox mirrors production but with isolated data. Create a sandbox tenant in Settings → Environments." },
          { heading: "Base URL", body: "`https://sandbox.api.reconiq.example/v1`" },
          { heading: "Reset Data", body: "Click Reset Sandbox to clear all test data and start fresh." },
        ],
      },
    ],
  },

  // ───────────────────────────────────────────────────────────────
  // 6. Release Notes
  // ───────────────────────────────────────────────────────────────
  {
    slug: "release-notes",
    name: "Release Notes",
    icon: "file-text",
    description: "New features, improvements, bug fixes, and deprecations.",
    articles: [
      {
        slug: "2026-07",
        title: "July 2026 Release",
        summary: "AI Copilot personas, enhanced tolerance ladders, and new DORA evidence export.",
        seoTitle: "ReconIQ July 2026 Release Notes",
        seoDescription: "ReconIQ July 2026: AI Copilot personas, tolerance ladder enhancements, DORA evidence export.",
        tags: ["release", "july", "2026"],
        readTime: 3,
        sections: [
          { heading: "New Features", body: "• AI Copilot Personas — configure role-specific knowledge scopes\n• DORA Evidence Export — one-click compliance pack\n• Tolerance Ladder Visualizer — graphical editor for thresholds" },
          { heading: "Improvements", body: "• 40% faster cascade matching\n• Dark mode polish\n• Bulk break assignment" },
          { heading: "Bug Fixes", body: "• Fixed PDF export pagination\n• Resolved webhook retry loop" },
        ],
      },
      {
        slug: "2026-06",
        title: "June 2026 Release",
        summary: "Multi-region data residency, enhanced audit log search, and new connectors.",
        seoTitle: "ReconIQ June 2026 Release Notes",
        seoDescription: "ReconIQ June 2026: multi-region data residency, audit log search, new connectors.",
        tags: ["release", "june", "2026"],
        readTime: 3,
        sections: [
          { heading: "New Features", body: "• Multi-Region Data Residency — choose EU, US, or APAC per tenant\n• Snowflake Connector\n• Audit Log Full-Text Search" },
          { heading: "Improvements", body: "• Faster signoff flow\n• Improved break category suggestions" },
        ],
      },
    ],
  },

  // ───────────────────────────────────────────────────────────────
  // 7. Troubleshooting
  // ───────────────────────────────────────────────────────────────
  {
    slug: "troubleshooting",
    name: "Troubleshooting",
    icon: "wrench",
    description: "Common issues, error codes, and how to resolve them.",
    articles: [
      {
        slug: "common-errors",
        title: "Common Errors",
        summary: "A reference of common error codes and how to fix them.",
        seoTitle: "ReconIQ Common Errors Reference",
        seoDescription: "Troubleshoot common ReconIQ errors: authentication failures, data ingestion issues, and more.",
        tags: ["errors", "troubleshooting"],
        readTime: 5,
        sections: [
          { heading: "AUTH_001 — Invalid Token", body: "Your API token is expired or revoked. Generate a new token in Settings → API Tokens." },
          { heading: "INGEST_002 — Column Mapping Failed", body: "The uploaded file doesn't match the expected schema. Re-map columns in the upload wizard." },
          { heading: "RECON_003 — No Matching Key", body: "The recon definition's matching key field is missing in one source. Check column names." },
        ],
      },
      {
        slug: "run-failures",
        title: "Run Failures",
        summary: "Diagnose and recover from failed reconciliation runs.",
        seoTitle: "ReconIQ Run Failure Troubleshooting",
        seoDescription: "Diagnose failed reconciliation runs in ReconIQ: causes, logs, and recovery steps.",
        tags: ["runs", "failures", "debug"],
        readTime: 4,
        sections: [
          { body: "A run can fail due to data source unavailability, schema mismatch, or system error." },
          { heading: "View Logs", body: "Click the failed run → Logs tab. Look for the first error message." },
          { heading: "Retry", body: "Fix the root cause, then click Retry Run. ReconIQ re-executes from the beginning." },
        ],
      },
    ],
  },

  // ───────────────────────────────────────────────────────────────
  // 8. FAQ
  // ───────────────────────────────────────────────────────────────
  {
    slug: "faq",
    name: "FAQ",
    icon: "help-circle",
    description: "Frequently asked questions about ReconIQ.",
    articles: [
      {
        slug: "general",
        title: "General FAQ",
        summary: "Answers to the most common questions about ReconIQ.",
        seoTitle: "ReconIQ General FAQ",
        seoDescription: "Frequently asked questions about ReconIQ: pricing, support, integrations, and more.",
        tags: ["faq", "general"],
        readTime: 4,
        sections: [
          { body: "Below are answers to the most common questions." },
        ],
        faq: [
          { q: "What is ReconIQ?", a: "ReconIQ (ReconIQ) is an AI-native reconciliation platform for financial institutions." },
          { q: "How is pricing calculated?", a: "Pricing is based on the number of reconciliation rows processed per month and the tier of features enabled. Contact sales for a quote." },
          { q: "Does ReconIQ support SSO?", a: "Yes. ReconIQ supports SAML 2.0 SSO with any identity provider (Okta, Azure AD, etc.)." },
          { q: "Can I self-host ReconIQ?", a: "ReconIQ is a cloud-hosted SaaS platform. Private cloud or on-prem deployments are available for enterprise customers." },
          { q: "How do I contact support?", a: "Submit a ticket via the Support Portal or email support@reconiq.example." },
        ],
      },
    ],
  },

  // ───────────────────────────────────────────────────────────────
  // 9. Contact / Submit Ticket
  // ───────────────────────────────────────────────────────────────
  {
    slug: "contact",
    name: "Contact Support",
    icon: "message-circle",
    description: "Submit a support ticket or reach the ReconIQ team.",
    articles: [
      {
        slug: "submit-ticket",
        title: "Submit a Support Ticket",
        summary: "How to submit a ticket and expected response times.",
        seoTitle: "Submit a Support Ticket | ReconIQ",
        seoDescription: "Submit a support ticket to ReconIQ and learn about SLA response times.",
        tags: ["support", "ticket", "contact"],
        readTime: 2,
        sections: [
          { body: "Use the form below or email support@reconiq.example. Include your tenant ID and a detailed description." },
          { heading: "Response Times", body: "• Critical (P1): 1 hour\n• High (P2): 4 hours\n• Normal (P3): 1 business day\n• Low (P4): 3 business days" },
        ],
      },
    ],
  },
  ];
}

let _categories: Category[] | undefined;
export function getSupportCategories(): Category[] {
  return _categories ??= buildSupportCategories();
}

// NOTE: A `SUPPORT_CATEGORIES` const export was intentionally removed — see
// LL-016. Rolldown wraps any `var X; var init_X = __esmMin(() => { X = … })`
// pattern it detects in a cyclic-import graph, and the wrapper's binding
// resolves to `undefined` across the cycle at SSR time, which crashes route
// registration with "init_support_toc is not a function". Callers should use
// `getSupportCategories()` (hoisted as a live binding across cycles).

// ───────────────────────────────────────────────────────────────
// HELPERS
// ───────────────────────────────────────────────────────────────

export function getCategoryBySlug(slug: string): Category | undefined {
  return getSupportCategories().find((c) => c.slug === slug);
}

export function getArticleBySlug(categorySlug: string, articleSlug: string): Article | undefined {
  const cat = getCategoryBySlug(categorySlug);
  return cat?.articles.find((a) => a.slug === articleSlug);
}

export function getAllArticles(): Array<Article & { categorySlug: string; categoryName: string }> {
  return getSupportCategories().flatMap((c) =>
    c.articles.map((a) => ({ ...a, categorySlug: c.slug, categoryName: c.name })),
  );
}

export function searchArticles(query: string): Array<Article & { categorySlug: string; categoryName: string }> {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  return getAllArticles().filter(
    (a) =>
      a.title.toLowerCase().includes(q) ||
      a.summary.toLowerCase().includes(q) ||
      a.tags.some((t) => t.toLowerCase().includes(q)),
  );
}
