import { Link, useRouterState } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRailAccordion } from "@/components/rail-accordion";

export type RailItem = {
  key: string;
  label: string;
  icon?: any;
  group?: string;
  /** Permission id required to see this item. `null`/undefined = always visible. */
  permission?: string | null;
};

/**
 * Left-rail navigation driven by `?page=<key>` URL search param.
 *
 * Consolidated IA with **strict single-open accordion** behavior: exactly
 * one group is expanded at a time. Clicking a collapsed group opens it and
 * closes every other group. Clicking the currently open group collapses it
 * (leaving none expanded). Navigating to a page in a different group
 * automatically moves the open state to that group so the active link is
 * always visible.
 *
 * Selection is persisted per-scope in `localStorage`.
 *
 * Pass `permissionSet=null` to bypass filtering (e.g. platform views).
 * Pass a Set of granted permission ids to hide gated items the user lacks.
 */
export function LeftRail({
  items,
  activeKey,
  defaultKey,
  permissionSet,
  storageScope,
  basePath,
}: {
  items: RailItem[];
  activeKey?: string;
  defaultKey: string;
  permissionSet?: Set<string> | null;
  /** Namespace for persisted open-group state (e.g. "platform", "tenant"). */
  storageScope?: string;
  /** Canonical parent path used when the rail is rendered around a child route. */
  basePath?: string;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const targetPath = basePath ?? pathname;
  const active = activeKey ?? defaultKey;

  const visible = useMemo(
    () =>
      items.filter((it) => {
        if (permissionSet == null) return true;
        if (!it.permission) return true;
        return permissionSet.has(it.permission);
      }),
    [items, permissionSet],
  );

  const groups = useMemo(() => {
    const g: Record<string, RailItem[]> = {};
    const order: string[] = [];
    for (const it of visible) {
      const key = it.group ?? "";
      if (!(key in g)) {
        g[key] = [];
        order.push(key);
      }
      g[key].push(it);
    }
    return { map: g, order };
  }, [visible]);

  // Which group holds the active page? That group takes priority.
  const activeGroup = visible.find((it) => it.key === active)?.group ?? "";

  const scope = storageScope ?? "rail";
  const storageKey = `fvi.rail.open.${scope}`;
  const accordion = useRailAccordion();

  // Fallback local state when no provider is mounted (keeps legacy callers
  // working). When a provider is present it owns the open state and
  // coordinates across every sidebar section.
  const [localOpenGroup, setLocalOpenGroup] = useState<string | null>(() => {
    if (accordion) return null;
    if (typeof window === "undefined") return activeGroup || null;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw === null) return activeGroup || null;
      const parsed = JSON.parse(raw);
      return typeof parsed === "string" ? parsed : activeGroup || null;
    } catch {
      return activeGroup || null;
    }
  });

  const groupId = (g: string) => `rail:${scope}:${g}`;
  const isGroupOpen = (g: string) =>
    accordion ? accordion.isOpen(groupId(g)) : localOpenGroup === g;

  // When navigation lands on a page in a different group, follow it so the
  // active link is visible without extra clicks.
  useEffect(() => {
    if (!activeGroup) return;
    if (accordion) {
      if (!accordion.isOpen(groupId(activeGroup))) accordion.setOpen(groupId(activeGroup));
    } else if (activeGroup !== localOpenGroup) {
      setLocalOpenGroup(activeGroup);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGroup]);

  useEffect(() => {
    if (accordion) return;
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(localOpenGroup));
    } catch {
      /* storage disabled — non-fatal */
    }
  }, [localOpenGroup, storageKey, accordion]);

  const toggle = (g: string) => {
    if (accordion) accordion.toggle(groupId(g));
    else setLocalOpenGroup((prev) => (prev === g ? null : g));
  };

  return (
    <nav
      aria-label="Section navigation"
      className="space-y-1 pr-1 pb-4"
    >
      {groups.order.map((g) => {
        const list = groups.map[g];
        const hasLabel = g.length > 0;
        const isOpen = !hasLabel || isGroupOpen(g);
        const groupIsActive = !!hasLabel && list.some((item) => item.key === active);
        const contentId = `rail-group-${scope}-${g.replace(/\s+/g, "-").toLowerCase()}`;
        return (
          <div
            key={g}
            className={cn(
              "mx-3 rounded-md border-l-2 border-transparent",
              groupIsActive && "bg-sidebar-accent",
            )}
            style={
              groupIsActive
                ? { borderLeftColor: "var(--brand-gold)", color: "var(--brand-gold)" }
                : undefined
            }
          >
            {hasLabel ? (
              <button
                type="button"
                onClick={() => toggle(g)}
                aria-expanded={isOpen}
                aria-controls={contentId}
                className={cn(
                  "group/label flex w-full items-center justify-between rounded px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold)]",
                  groupIsActive
                    ? "text-[color:var(--brand-gold)]"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/40 hover:text-sidebar-accent-foreground",
                )}
              >
                <span className="truncate">{g}</span>
                <ChevronRight
                  className={cn(
                    "h-3 w-3 shrink-0 transition-transform duration-200",
                    isOpen && "rotate-90",
                  )}
                />
              </button>
            ) : null}
            <div
              id={contentId}
              className={cn(
                "grid transition-[grid-template-rows,opacity] duration-200 ease-out",
                isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
              )}
              aria-hidden={!isOpen}
              inert={!isOpen}
            >
              <div className="overflow-hidden">
                <div className="mt-0.5 space-y-0.5">
                  {list.map((it) => {
                    const Icon = it.icon;
                    const isActive = it.key === active;
                    return (
                      <Link
                        key={it.key}
                        to={targetPath}
                        search={((prev: any) => ({ ...prev, page: it.key })) as any}
                        className={cn(
                          "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold)]",
                          isActive
                            ? "bg-[var(--brand-gold)] text-[#0e1a30] font-medium"
                            : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                        )}
                        style={
                          isActive
                            ? { backgroundColor: "var(--brand-gold)", color: "#0e1a30" }
                            : undefined
                        }
                        aria-current={isActive ? "page" : undefined}
                        tabIndex={isOpen ? 0 : -1}
                      >
                        {Icon ? <Icon className="h-4 w-4 shrink-0" /> : null}
                        <span className="truncate">{it.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </nav>
  );
}

/**
 * Breadcrumb that reflects the consolidated IA: Scope › Group › Page.
 * Rendered above the page container so the user always knows where they are.
 */
export function RailBreadcrumbs({
  items,
  activeKey,
  scopeLabel,
}: {
  items: RailItem[];
  activeKey: string;
  scopeLabel: string;
}) {
  const current = items.find((it) => it.key === activeKey);
  if (!current) return null;
  return (
    <nav
      aria-label="Breadcrumb"
      className="mb-4 flex items-center gap-1 text-xs text-muted-foreground"
    >
      <span className="font-medium text-foreground/70">{scopeLabel}</span>
      {current.group ? (
        <>
          <ChevronRight className="h-3 w-3 opacity-60" />
          <span>{current.group}</span>
        </>
      ) : null}
      <ChevronRight className="h-3 w-3 opacity-60" />
      <span className="text-foreground">{current.label}</span>
    </nav>
  );
}

export function PageContainer({ children }: { children: ReactNode }) {
  return <div className="animate-in fade-in-50 duration-200">{children}</div>;
}
