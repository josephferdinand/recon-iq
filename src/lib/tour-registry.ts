// Per-section guided tour registry. Keyed by a stable section id derived
// from the current route + ?page= query. Each tour shows once per user
// per section; the topbar button can replay it on demand.

export type TourStep = {
  element?: string;
  popover: { title: string; description: string };
};

export type TourDef = {
  id: string; // stable id, used in tourSeen
  title: string; // human label for the replay button tooltip
  steps: TourStep[];
};

// Workspace tours, keyed by ?page= value.
const WORKSPACE: Record<string, TourDef> = {
  dashboard: {
    id: "ws.dashboard",
    title: "Workspace dashboard",
    steps: [
      {
        popover: {
          title: "Workspace dashboard",
          description: "Live KPIs, throughput and exception trends for this workspace.",
        },
      },
      {
        element: "[data-tour='dashboard-kpis']",
        popover: {
          title: "KPI strip",
          description: "Auto-match rate, open breaks, SLA breaches and MTTR.",
        },
      },
    ],
  },
  overview: {
    id: "ws.overview",
    title: "Workspace overview",
    steps: [
      {
        popover: {
          title: "Overview",
          description: "Onboarding checklist plus recent hash-chained activity.",
        },
      },
      {
        element: "[data-tour='checklist']",
        popover: {
          title: "Onboarding checklist",
          description: "Track your first recon end-to-end.",
        },
      },
    ],
  },
  ingest: {
    id: "ws.ingest",
    title: "Ingestion Hub",
    steps: [
      {
        popover: {
          title: "Ingestion Hub",
          description: "All inbound data — files, connectors, watchers, AIDP — in one place.",
        },
      },
    ],
  },
  recons: {
    id: "ws.recons",
    title: "ReconIQ Studio",
    steps: [
      {
        popover: {
          title: "ReconIQ Studio",
          description:
            "Author reconciliations with one/two/three-sided modes, AI mapping and version history.",
        },
      },
    ],
  },
  exceptions: {
    id: "ws.exceptions",
    title: "Exceptions",
    steps: [
      {
        popover: {
          title: "Exceptions",
          description:
            "Filter, triage and resolve breaks. Use the side-by-side inspector for fast diagnosis.",
        },
      },
    ],
  },
  breakmgr: {
    id: "ws.breakmgr",
    title: "Break Manager",
    steps: [
      {
        popover: {
          title: "Break Manager",
          description: "Kanban view across lifecycle states with assignment, SLA and aging.",
        },
      },
    ],
  },
  reports: {
    id: "ws.reports",
    title: "Reports & Analytics",
    steps: [
      {
        popover: {
          title: "Reports",
          description: "Executive, operational, regulatory and custom report builder.",
        },
      },
    ],
  },
  agent: {
    id: "ws.agent",
    title: "Agentic AI",
    steps: [
      {
        popover: {
          title: "Agent",
          description: "Autonomous triage with policy-bound actions and full audit trail.",
        },
      },
    ],
  },
  eod: {
    id: "ws.eod",
    title: "EOD Sign-off",
    steps: [
      {
        popover: {
          title: "EOD Sign-off",
          description: "Close-of-day attestation with 4-eyes approval and immutable record.",
        },
      },
    ],
  },
};

// Tenant admin tours, keyed by ?page= value.
const TENANT: Record<string, TourDef> = {
  overview: {
    id: "tn.overview",
    title: "Tenant overview",
    steps: [
      {
        popover: {
          title: "Tenant administration",
          description: "Settings, members, BUs, AI governance and connectors.",
        },
      },
    ],
  },
  members: {
    id: "tn.members",
    title: "Members",
    steps: [
      {
        popover: {
          title: "Members",
          description: "Invite users, manage roles and group membership.",
        },
      },
    ],
  },
  bus: {
    id: "tn.bus",
    title: "Business Units",
    steps: [
      {
        popover: {
          title: "Business Units",
          description: "Hierarchical org modeling with BU-scoped data visibility.",
        },
      },
    ],
  },
  ai: {
    id: "tn.ai",
    title: "AI & LLM",
    steps: [
      {
        popover: {
          title: "AI configuration",
          description: "Choose models, BYOK and feature toggles.",
        },
      },
    ],
  },
  governance: {
    id: "tn.governance",
    title: "AI Governance",
    steps: [
      {
        popover: {
          title: "AI Governance",
          description: "Budgets, policies, PII redaction and audit.",
        },
      },
    ],
  },
  sso: {
    id: "tn.sso",
    title: "SSO",
    steps: [
      { popover: { title: "SSO", description: "Configure SAML/OIDC and SCIM provisioning." } },
    ],
  },
};

// Platform admin tours, keyed by ?page= value.
const PLATFORM: Record<string, TourDef> = {
  tenants: {
    id: "pl.tenants",
    title: "Tenants",
    steps: [
      {
        popover: {
          title: "Tenants",
          description: "Provision, configure and monitor tenants across the platform.",
        },
      },
    ],
  },
  breakglass: {
    id: "pl.breakglass",
    title: "Break-Glass",
    steps: [
      {
        popover: {
          title: "Break-Glass",
          description: "Time-bounded emergency access with 4-eyes approval.",
        },
      },
    ],
  },
  audit: {
    id: "pl.audit",
    title: "Platform Audit",
    steps: [
      {
        popover: {
          title: "Audit",
          description: "Hash-chained, SHA-256 anchored audit ledger across tenants.",
        },
      },
    ],
  },
  governance: {
    id: "pl.governance",
    title: "Platform AI Governance",
    steps: [
      { popover: { title: "AI Governance", description: "Global policies, pricing and budgets." } },
    ],
  },
};

const HOME: TourDef = {
  id: "home",
  title: "Home",
  steps: [
    {
      popover: {
        title: "Welcome to ReconIQ",
        description:
          "Use the left rail to navigate; the top bar holds Copilot, Themes and this tour.",
      },
    },
  ],
};

export const ALL_TOUR_IDS = Object.freeze([
  HOME.id,
  ...Object.values(WORKSPACE).map((tour) => tour.id),
  ...Object.values(TENANT).map((tour) => tour.id),
  ...Object.values(PLATFORM).map((tour) => tour.id),
]);

export function resolveTour(pathname: string, search: Record<string, unknown>): TourDef | null {
  const page = (search?.page as string | undefined) || "overview";
  if (pathname.startsWith("/platform")) return PLATFORM[page] ?? null;
  if (pathname.includes("/tenant")) return TENANT[page] ?? null;
  if (pathname.includes("/workspace")) return WORKSPACE[page] ?? null;
  if (pathname.startsWith("/home")) return HOME;
  return null;
}
