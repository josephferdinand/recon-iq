// Client-side workspace feature registry. Mirrors WORKSPACE_FEATURE_KEYS in
// src/lib/workspace.functions.ts. Tenant admins control every switch.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { listWorkspaceFeatures } from "@/lib/workspace.functions";

export const WORKSPACE_FEATURE_META: {
  key: string; group: string; label: string; description: string; priority: "P1" | "P2" | "P3"; gapId: string;
}[] = [
  { key: "dashboard_layouts",          group: "Home & Layout", label: "Drag-and-drop dashboard widgets",  description: "Users can add/remove/resize widgets and save personal layouts.", priority: "P1", gapId: "W-1" },
  { key: "recent_searches",            group: "Home & Layout", label: "Recent-searches surface",           description: "Show the user's recent searches on the home activity center.",  priority: "P3", gapId: "W-2" },
  { key: "announcement_banner",        group: "Home & Layout", label: "Workspace announcement banner",     description: "Tenant admins post an in-app banner with dismiss + audit.",     priority: "P2", gapId: "W-3" },
  { key: "dual_team_context",          group: "Navigation",    label: "Dual team context switcher",        description: "Primary + secondary team side-by-side context in the top bar.", priority: "P1", gapId: "W-4" },
  { key: "sidebar_shortcuts",          group: "Navigation",    label: "Custom sidebar shortcuts",          description: "Users can pin custom sidebar links beyond favorites/recents.",  priority: "P3", gapId: "W-5" },
  { key: "back_button_audit",          group: "Navigation",    label: "Back-button coverage enforcement",  description: "Enforce back-button presence on every route via runtime audit.",priority: "P2", gapId: "W-6" },
  { key: "theme_catalog_expanded",     group: "Theme",         label: "Expanded theme catalog (≥15)",      description: "Surface the full named-palette catalog to users.",              priority: "P2", gapId: "W-7" },
  { key: "theme_wcag_scoring",         group: "Theme",         label: "Theme WCAG scoring in picker",      description: "Show contrast score and gate below-AA themes.",                 priority: "P2", gapId: "W-8" },
  { key: "notification_prefs_matrix",  group: "Profile",       label: "Per-user notification matrix",      description: "Channel × event-type toggle grid with digest cadence.",         priority: "P1", gapId: "W-9" },
  { key: "extended_profile_fields",    group: "Profile",       label: "Extended profile fields",           description: "Users may edit job title / employee ID / biography.",           priority: "P2", gapId: "W-10" },
  { key: "teams_primitive",            group: "Teams",         label: "Teams primitive (T-11)",            description: "Enable the tenant-wide teams data plane.",                      priority: "P1", gapId: "W-11" },
  { key: "team_context_switcher",      group: "Teams",         label: "Team context switcher",             description: "Show a team switcher in the top bar (remembers last team).",    priority: "P1", gapId: "W-12" },
  { key: "team_shared_workspaces",     group: "Teams",         label: "Team shared workspaces",            description: "Shared files/dashboards/reports scoped to a team.",             priority: "P1", gapId: "W-13" },
  { key: "mentions",                   group: "Collab",        label: "@mentions with notifications",      description: "@name mentions in notes/comments/tickets fan out notifications.",priority: "P1", gapId: "W-14" },
  { key: "comments_reactions",         group: "Collab",        label: "Comments + reactions primitive",    description: "Attach the shared comments/reactions component to any record.", priority: "P1", gapId: "W-15" },
  { key: "task_assignment",            group: "Productivity",  label: "Task assignment",                   description: "First-class tasks with assignee, priority, and 'my queue'.",    priority: "P2", gapId: "W-16" },
  { key: "availability_status",        group: "Collab",        label: "Availability status",               description: "User availability (available / busy / DND / away).",            priority: "P3", gapId: "W-17" },
  { key: "autosave_drafts",            group: "Productivity",  label: "Autosave + draft recovery",         description: "Framework-level autosave to drafts with restore + conflict.",   priority: "P1", gapId: "W-18" },
  { key: "version_recovery",           group: "Productivity",  label: "Version recovery UI",               description: "Surface prior versions of records with diff + restore.",        priority: "P2", gapId: "W-19" },
  { key: "progressive_skeletons",      group: "Productivity",  label: "Progressive loading skeletons",     description: "Use skeletons universally on list surfaces.",                   priority: "P2", gapId: "W-20" },
  { key: "single_session_enforcement", group: "Sessions",      label: "Single-session enforcement",        description: "Managed project-wide in Supabase Auth; this is not a tenant-controlled switch.", priority: "P1", gapId: "W-21" },
  { key: "logout_all_devices",         group: "Sessions",      label: "Log out other devices",             description: "Revoke other Supabase Auth sessions while keeping the current one.", priority: "P2", gapId: "W-22" },
  { key: "device_change_audit",        group: "Sessions",      label: "Device-change audit event",         description: "Emit a distinct audit event when device changes on login.",     priority: "P3", gapId: "W-23" },
  { key: "universal_error_boundary",   group: "Standards",     label: "Universal error boundary",          description: "Global error boundary with reference ID + copy diagnostics.",   priority: "P1", gapId: "W-24" },
  { key: "empty_state_library",        group: "Standards",     label: "Empty-state component library",     description: "Shared onboarding-CTA empty states across lists.",              priority: "P2", gapId: "W-25" },
  { key: "perf_budgets",               group: "Standards",     label: "Perf budgets in CI",                description: "Enforce LCP/INP budgets on critical routes.",                   priority: "P2", gapId: "W-26" },
  { key: "team_id_on_audit",           group: "Audit",         label: "team_id dimension on audit_log",    description: "Stamp team_id on every audit write.",                           priority: "P1", gapId: "W-27" },
  { key: "read_path_audit",            group: "Audit",         label: "Read-path audit",                   description: "Log sensitive-record reads to workspace_read_events.",          priority: "P2", gapId: "W-28" },
];

type FeatureMap = Record<string, { enabled: boolean; config: any } | undefined>;

const Ctx = createContext<{ features: FeatureMap; loading: boolean; refresh: () => void }>({
  features: {}, loading: true, refresh: () => {},
});

export function WorkspaceFeaturesProvider({ tenantId, children }: { tenantId: string | null | undefined; children: ReactNode }) {
  const listFn = useServerFn(listWorkspaceFeatures);
  const [features, setFeatures] = useState<FeatureMap>({});
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!tenantId) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    listFn({ data: { tenantId } }).then((rows) => {
      if (cancelled) return;
      const m: FeatureMap = {};
      for (const r of rows) m[r.key] = { enabled: r.enabled, config: r.config };
      setFeatures(m); setLoading(false);
    }).catch(() => setLoading(false));
    return () => { cancelled = true; };
  }, [tenantId, tick, listFn]);
  return <Ctx.Provider value={{ features, loading, refresh: () => setTick((t) => t + 1) }}>{children}</Ctx.Provider>;
}

export function useWorkspaceFeature(key: string): boolean {
  const { features } = useContext(Ctx);
  return !!features[key]?.enabled;
}

export function useWorkspaceFeatures() {
  return useContext(Ctx);
}
