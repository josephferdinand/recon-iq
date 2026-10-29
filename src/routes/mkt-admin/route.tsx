import { createFileRoute, Link, Outlet, redirect, useRouter, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { myMktRoles, bootstrapSuperAdmin, assertMktRolesFn, platformAdminSelfGrantMkt } from "@/lib/mkt-admin.functions";
import { recordAccessDenied } from "@/lib/access-audit.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { RQSeal } from "@/components/rq-seal";
import {
  LayoutDashboard, Users, GitBranch, CalendarClock, MessageSquare, Database, Cpu,
  BarChart3, LogOut, ShieldCheck, Building2, LayoutTemplate, ScrollText, Palette,
  Film, KeyRound, Sparkles, Search, ExternalLink, ChevronRight, ArrowLeft, Gem,
} from "lucide-react";
import { MKT_TAB_ROLES, hasAnyMktRole, type MktRole } from "@/lib/mkt-admin-roles";

export const Route = createFileRoute("/mkt-admin")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth", search: { redirect: "/mkt-admin" } });

    const { data: isSuper, error: rpcErr } = await supabase
      .rpc("is_platform_super_admin", { _user_id: data.user.id });
    if (rpcErr || !isSuper) {
      // Fire-and-forget audit before redirect
      try {
        await recordAccessDenied({ data: {
          surface: "mkt-admin",
          reason: rpcErr ? "super_admin_check_failed" : "not_platform_super_admin",
          required_role: "platform_super_admin",
          path: location.pathname + (location.search ?? ""),
          referrer: typeof document !== "undefined" ? document.referrer : undefined,
          context: rpcErr ? { rpc_error: rpcErr.message } : {},
        } });
      } catch {}
      throw redirect({ to: "/console" });
    }

    if (location.pathname !== "/mkt-admin") {
      try {
        await assertMktRolesFn({ data: { allowed: ["super_admin","sales_admin","marketing_admin","ai_admin"] } });
      } catch {
        throw redirect({ to: "/mkt-admin" });
      }
    }
    return { user: data.user };
  },
  component: MktAdminLayout,
});

type NavItem = { to: string; label: string; icon: typeof LayoutDashboard; desc?: string; requiredRoles?: readonly MktRole[] };
const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Overview",
    items: [
      { to: "/mkt-admin", label: "Dashboard", icon: LayoutDashboard, desc: "At-a-glance KPIs" },
      { to: "/mkt-admin/analytics", label: "Analytics", icon: BarChart3, desc: "Site & funnel metrics" },
      { to: "/mkt-admin/cta-analytics", label: "CTA tracking", icon: BarChart3, desc: "Button & link events" },
    ],
  },
  {
    label: "Brand management",
    items: [
      { to: "/mkt-admin/brand", label: "Brand profile", icon: Gem, requiredRoles: MKT_TAB_ROLES.brand, desc: "Company, product, contact" },
      { to: "/mkt-admin/brand/assets", label: "Brand assets", icon: Building2, requiredRoles: MKT_TAB_ROLES.brand, desc: "Logos, favicon, watermarks" },
      { to: "/mkt-admin/brand/identity", label: "App identity", icon: LayoutTemplate, requiredRoles: MKT_TAB_ROLES.brand, desc: "Titles, footers, copyright" },
      { to: "/mkt-admin/brand/communications", label: "Communications", icon: MessageSquare, requiredRoles: MKT_TAB_ROLES.brand, desc: "Email / PDF branding" },
      { to: "/mkt-admin/brand/login", label: "Login branding", icon: KeyRound, requiredRoles: MKT_TAB_ROLES.brand, desc: "Sign-in screen" },
      { to: "/mkt-admin/brand/white-label", label: "White label", icon: Sparkles, requiredRoles: MKT_TAB_ROLES.brand, desc: "Tenant overrides" },
      { to: "/mkt-admin/brand/history", label: "Brand history", icon: ScrollText, requiredRoles: MKT_TAB_ROLES.brand, desc: "Audit & rollback" },
    ],
  },
  {
    label: "Site management",
    items: [
      { to: "/mkt-admin/homepage", label: "Homepage sections", icon: LayoutTemplate, requiredRoles: MKT_TAB_ROLES.homepage },
      { to: "/mkt-admin/media", label: "Media & reels", icon: Film, requiredRoles: MKT_TAB_ROLES.media },
      { to: "/mkt-admin/themes", label: "Website themes", icon: Palette, requiredRoles: MKT_TAB_ROLES.themes },
      { to: "/mkt-admin/site-logos", label: "Trusted-by logos", icon: Building2, requiredRoles: MKT_TAB_ROLES.site_logos },
      { to: "/mkt-admin/chatbot", label: "Chatbot prompts", icon: MessageSquare, requiredRoles: MKT_TAB_ROLES.chatbot },
      { to: "/mkt-admin/appointments", label: "Appointment settings", icon: CalendarClock, requiredRoles: MKT_TAB_ROLES.appointments },
    ],
  },
  {
    label: "CRM & content",
    items: [
      { to: "/mkt-admin/leads", label: "Leads", icon: Users, requiredRoles: MKT_TAB_ROLES.leads },
      { to: "/mkt-admin/pipeline", label: "Pipeline", icon: GitBranch, requiredRoles: MKT_TAB_ROLES.leads },
      { to: "/mkt-admin/knowledge", label: "Knowledge base", icon: Database },
    ],
  },
  {
    label: "Platform",
    items: [
      { to: "/mkt-admin/ai-models", label: "AI models", icon: Cpu, requiredRoles: MKT_TAB_ROLES.ai_models },
      { to: "/mkt-admin/ai-usage", label: "AI usage & costs", icon: BarChart3, desc: "Spend, tokens, INR/USD" },
      { to: "/mkt-admin/vault", label: "Secure vault", icon: KeyRound, requiredRoles: MKT_TAB_ROLES.vault },
      { to: "/mkt-admin/users", label: "Users & roles", icon: ShieldCheck },
      { to: "/mkt-admin/audit", label: "Audit log", icon: ScrollText },
    ],
  },
];

function MktAdminLayout() {
  const rolesFn = useServerFn(myMktRoles);
  const bootFn = useServerFn(bootstrapSuperAdmin);
  const selfGrantFn = useServerFn(platformAdminSelfGrantMkt);
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [q, setQ] = useState("");

  const rolesQ = useQuery({ queryKey: ["mkt","roles"], queryFn: () => rolesFn({ data: undefined }) });

  const flatNav = useMemo(
    () => NAV_GROUPS.flatMap((g) => g.items.map((i) => ({ ...i, group: g.label }))),
    [],
  );
  const active = flatNav.find((n) =>
    n.to === "/mkt-admin" ? pathname === "/mkt-admin" : pathname.startsWith(n.to),
  );

  if (rolesQ.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Loading marketing console…
      </div>
    );
  }

  const roles = rolesQ.data ?? [];

  if (roles.length === 0) {
    return (
      <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-background via-background to-muted/40 px-4">
        <div aria-hidden className="pointer-events-none absolute -top-32 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full opacity-40 blur-3xl"
          style={{ background: "radial-gradient(closest-side, var(--brand-gold, hsl(var(--primary))), transparent)" }} />
        <div className="relative z-10 w-full max-w-lg rounded-2xl border border-border bg-card/80 p-8 text-center shadow-xl backdrop-blur">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary">
            <ShieldCheck className="h-7 w-7" />
          </div>
          <h1 className="font-display text-2xl font-semibold">Marketing admin portal</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            You don't yet have marketing admin roles. Platform Owners can self-grant
            <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">super_admin</code>.
            First-time operators (no super admin exists) can bootstrap instead.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Button onClick={async () => {
              try { await selfGrantFn({ data: undefined }); await rolesQ.refetch(); router.invalidate(); }
              catch (e) { alert((e as Error).message || "Self-grant denied — you are not a Platform Owner."); }
            }}>Grant me super_admin</Button>
            <Button variant="outline" onClick={async () => {
              const res = await bootFn({ data: undefined });
              if (res.promoted) { await rolesQ.refetch(); router.invalidate(); }
              else alert("A super admin already exists. Ask them to grant you a role.");
            }}>Bootstrap super admin</Button>
            <Button asChild variant="ghost"><Link to="/console"><ArrowLeft className="mr-1 h-4 w-4" /> Back to console</Link></Button>
          </div>
        </div>
      </div>
    );
  }

  const filteredGroups = q.trim()
    ? NAV_GROUPS.map((g) => ({
        ...g,
        items: g.items.filter((i) => i.label.toLowerCase().includes(q.toLowerCase())),
      })).filter((g) => g.items.length > 0)
    : NAV_GROUPS;

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-background via-background to-muted/20">
      {/* SIDEBAR */}
      <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col border-r border-border/60 bg-card/40 backdrop-blur-xl">
        <div className="flex items-center gap-3 border-b border-border/60 px-5 py-4">
          <div className="relative">
            <RQSeal className="h-9 w-9" />
            <span aria-hidden className="absolute -inset-1 -z-10 rounded-full opacity-40 blur-md"
              style={{ background: "radial-gradient(closest-side, var(--brand-gold, hsl(var(--primary))), transparent)" }} />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">ReconIQ</div>
            <div className="truncate font-display text-sm font-semibold">Marketing Console</div>
          </div>
        </div>

        <div className="px-3 pt-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Jump to…"
              className="h-8 border-border/60 bg-background/60 pl-8 text-xs" />
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto p-3 space-y-4">
          {filteredGroups.map((group) => {
            const visible = group.items.filter((n) => !n.requiredRoles || hasAnyMktRole(roles, n.requiredRoles));
            if (visible.length === 0) return null;
            return (
              <div key={group.label}>
                <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
                  {group.label}
                </div>
                <div className="space-y-0.5">
                  {visible.map((n) => {
                    const Icon = n.icon;
                    const isActive = n.to === "/mkt-admin" ? pathname === "/mkt-admin" : pathname.startsWith(n.to);
                    return (
                      <Link key={n.to} to={n.to}
                        activeOptions={{ exact: n.to === "/mkt-admin" }}
                        className={`group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition ${
                          isActive
                            ? "bg-gradient-to-r from-primary/15 via-primary/10 to-transparent text-foreground"
                            : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                        }`}
                      >
                        {isActive && <span aria-hidden className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-primary" />}
                        <Icon className={`h-4 w-4 shrink-0 ${isActive ? "text-primary" : ""}`} />
                        <span className="truncate">{n.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="border-t border-border/60 p-3 space-y-2">
          <div className="rounded-lg border border-border/60 bg-background/60 p-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Your roles</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {roles.map((r) => (
                <Badge key={r} variant="secondary" className="h-5 px-1.5 text-[10px] font-medium">{r}</Badge>
              ))}
            </div>
          </div>
          <Button asChild variant="ghost" size="sm" className="w-full justify-start text-muted-foreground">
            <Link to="/console"><ArrowLeft className="mr-2 h-4 w-4" /> Console chooser</Link>
          </Button>
          <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground"
            onClick={async () => { await supabase.auth.signOut(); window.location.assign("/"); }}>
            <LogOut className="mr-2 h-4 w-4" /> Sign out
          </Button>
        </div>
      </aside>

      {/* MAIN */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* HEADER */}
        <header className="sticky top-0 z-20 border-b border-border/60 bg-background/70 backdrop-blur-xl">
          <div className="flex h-14 items-center gap-4 px-6">
            <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
              <Link to="/mkt-admin" className="hover:text-foreground">Marketing</Link>
              {active && active.to !== "/mkt-admin" && (
                <>
                  <ChevronRight className="h-3.5 w-3.5 opacity-60" />
                  <span className="text-xs uppercase tracking-wider text-muted-foreground/70">{active.group}</span>
                  <ChevronRight className="h-3.5 w-3.5 opacity-60" />
                  <span className="truncate font-medium text-foreground">{active.label}</span>
                </>
              )}
            </nav>
            <div className="ml-auto flex items-center gap-2">
              <Badge variant="outline" className="hidden gap-1 border-primary/40 bg-primary/5 text-primary md:inline-flex">
                <Sparkles className="h-3 w-3" /> Super Admin
              </Badge>
              <Button asChild variant="outline" size="sm">
                <a href="/" target="_blank" rel="noreferrer">
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> View site
                </a>
              </Button>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-x-auto">
          <div className="mx-auto max-w-7xl px-6 py-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
