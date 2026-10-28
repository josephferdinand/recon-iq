export const PLATFORM_PAGE_KEYS = new Set([
  "ai-control-plane",
  "ops-console",
  "security-audit",
  "sessions-security",
  "tickets",
  "worker-health",
]);

export type OpsConsoleLink = {
  label: string;
  to: "/platform" | "/platform-backup";
  search?: { page: string };
};

export const OPS_CONSOLE_LINKS: Record<string, OpsConsoleLink> = {
  workers: {
    label: "Worker health",
    to: "/platform",
    search: { page: "worker-health" },
  },
  chaos: {
    label: "Chaos schedule",
    to: "/platform",
    search: { page: "ops-console" },
  },
  dr: { label: "DR / failover", to: "/platform-backup" },
  alerts: {
    label: "Security alerts",
    to: "/platform",
    search: { page: "security-audit" },
  },
  hitl: {
    label: "AI governance",
    to: "/platform",
    search: { page: "ai-control-plane" },
  },
  login: {
    label: "Sessions & security",
    to: "/platform",
    search: { page: "sessions-security" },
  },
  kill: {
    label: "Kill switches",
    to: "/platform",
    search: { page: "ai-control-plane" },
  },
  backups: { label: "Backups", to: "/platform-backup" },
  sla: {
    label: "SLA policies",
    to: "/platform",
    search: { page: "tickets" },
  },
};
