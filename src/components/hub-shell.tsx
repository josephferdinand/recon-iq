/**
 * HubShell — Phase 2 Medium-Term.
 *
 * Reusable presentation for consolidation hubs (AI Ops, Reporting Studio,
 * Access Control, Observability, Resilience Center, Key & Secret Vault,
 * Exception Workbench, Analytics Hub, Unified Entitlements).
 *
 * Each hub is a card grid linking to the underlying surfaces. Hubs do NOT
 * replace the surfaces — they replace the fragmented left-rail hunt.
 */
import { Link } from "@tanstack/react-router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, type LucideIcon } from "lucide-react";
import { BackButton } from "@/components/back-button";
import { useKpi } from "@/hooks/use-kpi";
import { KPI_REGISTRY } from "@/lib/kpi-registry";

export interface HubEntry {
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
  badge?: string;
}

export interface HubShellProps {
  eyebrow: string;
  title: string;
  intro: string;
  entries: HubEntry[];
  /** Optional KPI ids from KPI_REGISTRY to render as a top strip. */
  kpiIds?: string[];
  /** Tenant scope for KPIs that need it. */
  tenantId?: string;
}

function KpiTile({ id, tenantId }: { id: string; tenantId?: string }) {
  const def = KPI_REGISTRY[id];
  const q = useKpi(id, { tenantId });
  if (!def) return null;
  return (
    <Card className="min-w-[10rem]">
      <CardHeader className="pb-2">
        <CardDescription className="text-xs uppercase tracking-wider">{def.title}</CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="text-2xl font-semibold tabular-nums">
          {q.isLoading ? "…" : q.data?.value ?? "—"}
        </div>
      </CardContent>
    </Card>
  );
}

export function HubShell({ eyebrow, title, intro, entries, kpiIds, tenantId }: HubShellProps) {
  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <BackButton />
      <header className="mt-6 mb-8">
        <p className="text-sm font-semibold uppercase tracking-wider text-primary">{eyebrow}</p>
        <h1 className="text-3xl font-semibold">{title}</h1>
        <p className="text-muted-foreground mt-2 max-w-3xl">{intro}</p>
      </header>
      {kpiIds && kpiIds.length > 0 ? (
        <div className="mb-8 flex flex-wrap gap-3">
          {kpiIds.map((id) => (
            <KpiTile key={id} id={id} tenantId={tenantId} />
          ))}
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {entries.map((e) => {
          const Icon = e.icon;
          return (
            <Link key={e.href + e.title} to={e.href} className="group">
              <Card className="h-full transition-colors hover:border-primary/50">
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Icon className="h-5 w-5 text-primary" />
                      <CardTitle className="text-base">{e.title}</CardTitle>
                    </div>
                    {e.badge ? <Badge variant="secondary">{e.badge}</Badge> : null}
                  </div>
                  <CardDescription>{e.description}</CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  <span className="inline-flex items-center gap-1 text-sm text-foreground/80 group-hover:text-foreground">
                    Open <ArrowRight className="h-3.5 w-3.5" />
                  </span>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </main>
  );
}
