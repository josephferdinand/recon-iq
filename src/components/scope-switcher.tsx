import { Link, useRouterState } from "@tanstack/react-router";
import { Briefcase, Settings as SettingsIcon, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";

export type Scope = "workspace" | "tenant" | "platform";

export function ScopeSwitcher({
  current,
  tenantSlug,
  canPlatform,
  canTenant = false,
}: {
  current: Scope;
  tenantSlug?: string;
  canPlatform?: boolean;
  canTenant?: boolean;
}) {
  const items: { key: Scope; label: string; icon: any; to: string; params?: any; show: boolean }[] = [
    { key: "workspace", label: "Workspace", icon: Briefcase, to: "/$slug/workspace", params: { slug: tenantSlug }, show: !!tenantSlug },
    { key: "tenant", label: "Tenant", icon: SettingsIcon, to: "/$slug/tenant", params: { slug: tenantSlug }, show: !!tenantSlug && !!canTenant },
    { key: "platform", label: "Platform", icon: ShieldAlert, to: "/platform", show: !!canPlatform },
  ];
  const visible = items.filter((i) => i.show);
  if (visible.length <= 1) return null;
  return (
    <div
      role="tablist"
      aria-label="Scope"
      className="inline-flex items-center gap-0.5 rounded-lg border bg-card p-0.5 shadow-sm"
    >
      {visible.map((it) => {
        const Active = current === it.key;
        const Icon = it.icon;
        return (
          <Link
            key={it.key}
            to={it.to as any}
            params={it.params as any}
            role="tab"
            aria-selected={Active}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              Active
                ? "bg-primary text-primary-foreground shadow"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {it.label}
          </Link>
        );
      })}
    </div>
  );
}

// Helper: detect current scope from pathname
export function useCurrentScope(): Scope | null {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (pathname.startsWith("/platform")) return "platform";
  const parts = pathname.replace(/^\//, "").split("/");
  if (parts[1] === "tenant") return "tenant";
  if (parts[1] === "workspace") return "workspace";
  return null;
}
