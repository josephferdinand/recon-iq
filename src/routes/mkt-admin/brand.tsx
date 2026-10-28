import { createFileRoute, Link, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import { assertMktRolesFn } from "@/lib/mkt-admin.functions";
import { MKT_TAB_ROLES } from "@/lib/mkt-admin-roles";
import { Gem, Building2, LayoutTemplate, MessageSquare, KeyRound, Sparkles, ScrollText, GitPullRequest } from "lucide-react";

export const Route = createFileRoute("/mkt-admin/brand")({
  beforeLoad: async () => {
    try { await assertMktRolesFn({ data: { allowed: MKT_TAB_ROLES.brand } }); }
    catch { throw redirect({ to: "/mkt-admin" }); }
  },
  component: BrandLayout,
});

type Tab = { to: string; label: string; icon: typeof Gem; exact?: boolean };
const TABS: Tab[] = [
  { to: "/mkt-admin/brand", label: "Profile", icon: Gem, exact: true },
  { to: "/mkt-admin/brand/assets", label: "Assets", icon: Building2 },
  { to: "/mkt-admin/brand/identity", label: "App identity", icon: LayoutTemplate },
  { to: "/mkt-admin/brand/communications", label: "Communications", icon: MessageSquare },
  { to: "/mkt-admin/brand/login", label: "Login", icon: KeyRound },
  { to: "/mkt-admin/brand/white-label", label: "White label", icon: Sparkles },
  { to: "/mkt-admin/brand/approvals", label: "Approvals", icon: GitPullRequest },
  { to: "/mkt-admin/brand/history", label: "History", icon: ScrollText },
];

function BrandLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-foreground">Brand Management</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Central control of every branded surface — website, portal, app, emails, documents, and tenant white-label.
        </p>
      </div>

      <nav className="flex flex-wrap gap-1 border-b border-border/60">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = t.exact ? pathname === t.to : pathname.startsWith(t.to);
          return (
            <Link key={t.to} to={t.to as string as "/mkt-admin/brand"}
              activeOptions={{ exact: !!t.exact }}
              className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition ${
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" /> {t.label}
            </Link>
          );
        })}
      </nav>

      <Outlet />
    </div>
  );
}
