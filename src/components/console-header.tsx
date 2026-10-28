/**
 * ConsoleHeader — shared persona-led header band for the Advanced Consoles
 * (Domain / Vertical / Scale).
 *
 * Renders: persona chip, title, one-liner, KPI tiles (2–6), and an optional
 * primary CTA. Purely presentational — data is passed in.
 *
 * Design goal: make the three consoles instantly distinguishable at a glance
 * (Phase A of the expert-panel blueprint — see docs/88_advanced_consoles_blueprint.md).
 */
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { LucideIcon } from "lucide-react";

export interface ConsoleKpi {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "default" | "positive" | "warning" | "danger";
  icon?: LucideIcon;
}

export interface ConsoleCta {
  label: string;
  onClick?: () => void;
  href?: string;
  variant?: "default" | "outline" | "secondary";
}

export function ConsoleHeader({
  persona,
  title,
  tagline,
  accent,
  kpis,
  loading,
  primaryCta,
  secondaryCta,
}: {
  persona: string;
  title: string;
  tagline: string;
  accent: "domain" | "vertical" | "scale";
  kpis: ConsoleKpi[];
  loading?: boolean;
  primaryCta?: ConsoleCta;
  secondaryCta?: ConsoleCta;
}) {
  const accentClass =
    accent === "domain"
      ? "from-sky-500/10 via-transparent to-transparent border-sky-500/20"
      : accent === "vertical"
      ? "from-violet-500/10 via-transparent to-transparent border-violet-500/20"
      : "from-emerald-500/10 via-transparent to-transparent border-emerald-500/20";

  return (
    <div className={`rounded-xl border bg-gradient-to-br ${accentClass} p-5 space-y-4`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <Badge variant="outline" className="uppercase tracking-wide text-[10px]">
            For: {persona}
          </Badge>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground max-w-3xl">{tagline}</p>
        </div>
        <div className="flex items-center gap-2">
          {secondaryCta && (
            <Button
              variant={secondaryCta.variant ?? "outline"}
              size="sm"
              onClick={secondaryCta.onClick}
              asChild={!!secondaryCta.href}
            >
              {secondaryCta.href ? <a href={secondaryCta.href}>{secondaryCta.label}</a> : <span>{secondaryCta.label}</span>}
            </Button>
          )}
          {primaryCta && (
            <Button
              variant={primaryCta.variant ?? "default"}
              size="sm"
              onClick={primaryCta.onClick}
              asChild={!!primaryCta.href}
            >
              {primaryCta.href ? <a href={primaryCta.href}>{primaryCta.label}</a> : <span>{primaryCta.label}</span>}
            </Button>
          )}
        </div>
      </div>
      <div className={`grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-${Math.min(kpis.length, 6)}`}>
        {kpis.map((k) => (
          <KpiTile key={k.label} kpi={k} loading={loading} />
        ))}
      </div>
    </div>
  );
}

function KpiTile({ kpi, loading }: { kpi: ConsoleKpi; loading?: boolean }) {
  const toneClass =
    kpi.tone === "positive"
      ? "text-emerald-600 dark:text-emerald-400"
      : kpi.tone === "warning"
      ? "text-amber-600 dark:text-amber-400"
      : kpi.tone === "danger"
      ? "text-rose-600 dark:text-rose-400"
      : "text-foreground";
  const Icon = kpi.icon;
  return (
    <Card className="bg-background/60 backdrop-blur">
      <CardContent className="p-3">
        <div className="flex items-center justify-between">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{kpi.label}</p>
          {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
        </div>
        {loading ? (
          <Skeleton className="h-6 w-16 mt-1" />
        ) : (
          <p className={`text-xl font-semibold mt-1 ${toneClass}`}>{kpi.value}</p>
        )}
        {kpi.hint && <p className="text-[11px] text-muted-foreground mt-0.5">{kpi.hint}</p>}
      </CardContent>
    </Card>
  );
}

/**
 * EmptyStateAction — richer empty state with a real next action rather than a bare "No X."
 */
export function EmptyStateAction({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: Array<{ label: string; onClick?: () => void; href?: string; variant?: "default" | "outline" | "secondary" }>;
}) {
  return (
    <div className="rounded-md border border-dashed p-6 text-center space-y-2">
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="text-xs text-muted-foreground max-w-md mx-auto">{description}</p>}
      {actions && actions.length > 0 && (
        <div className="flex flex-wrap justify-center gap-2 pt-2">
          {actions.map((a) => (
            <Button
              key={a.label}
              size="sm"
              variant={a.variant ?? "outline"}
              onClick={a.onClick}
              asChild={!!a.href}
            >
              {a.href ? <a href={a.href}>{a.label}</a> : <span>{a.label}</span>}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
