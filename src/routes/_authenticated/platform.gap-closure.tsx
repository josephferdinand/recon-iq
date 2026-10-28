import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { ArrowLeft, Circle, CircleDot, CheckCircle2, ExternalLink } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  GAP_ITEMS,
  GAP_COUNT,
  getGapEvidenceStatus,
  type GapCategory,
  type GapEvidenceStatus,
} from "@/lib/gap-closure.registry";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/platform/gap-closure")({
  beforeLoad: () => {
    throw redirect({ to: "/platform", search: { page: "gap-closure" } });
  },
  component: () => null,
});

const CATEGORY_ORDER: GapCategory[] = [
  "Billing & Revenue",
  "Contracts & Compliance",
  "Identity & Policy",
  "AI Risk",
  "Lifecycle & Deploy",
  "UX & Automation",
  "Ops & Reliability",
  "Security Hardening",
];

function statusIcon(status: GapEvidenceStatus) {
  switch (status) {
    case "verified":
      return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" aria-hidden />;
    case "wired":
      return <CircleDot className="h-3.5 w-3.5 text-amber-500" aria-hidden />;
    default:
      return <Circle className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />;
  }
}

function statusClass(status: GapEvidenceStatus) {
  switch (status) {
    case "verified":
      return "border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400";
    case "wired":
      return "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

export function GapClosureContent() {
  const grouped = CATEGORY_ORDER.map((cat) => ({
    cat,
    items: GAP_ITEMS.filter((i) => i.category === cat),
  }));

  const verified = GAP_ITEMS.filter((item) => getGapEvidenceStatus(item) === "verified").length;
  const wired = GAP_ITEMS.filter((item) => getGapEvidenceStatus(item) === "wired").length;
  const catalogued = GAP_COUNT - verified - wired;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <Link to="/platform" className="hover:text-foreground">
          <ArrowLeft className="mr-1 inline h-3.5 w-3.5" /> Platform
        </Link>
        <span>/</span>
        <span className="text-foreground">Gap closure</span>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">
            Gap closure <span className="text-muted-foreground">({GAP_COUNT})</span>
          </h1>
          <p className="text-sm text-muted-foreground">
            Evidence status for catalogued platform claims. Verified requires test or runtime
            evidence; wired confirms an active UI consumer; catalogued is not a delivery claim.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <Badge
            variant="outline"
            className="border-emerald-500/40 text-emerald-700 dark:text-emerald-400"
          >
            <CheckCircle2 className="mr-1 h-3 w-3" /> {verified} verified
          </Badge>
          <Badge
            variant="outline"
            className="border-amber-500/50 text-amber-700 dark:text-amber-400"
          >
            <CircleDot className="mr-1 h-3 w-3" /> {wired} wired
          </Badge>
          <Badge variant="outline" className="text-muted-foreground">
            <Circle className="mr-1 h-3 w-3" /> {catalogued} catalogued
          </Badge>
        </div>
      </header>

      <div className="space-y-8">
        {grouped.map(({ cat, items }) => (
          <section key={cat} className="space-y-3">
            <div className="flex items-baseline justify-between border-b border-border pb-1">
              <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {cat}
              </h2>
              <span className="text-xs text-muted-foreground">
                {items.length} item{items.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((item) => {
                const status = getGapEvidenceStatus(item);
                return (
                  <Card key={item.id} className="border transition-colors hover:border-primary/40">
                    <CardContent className="flex h-full flex-col gap-2 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          {statusIcon(status)}
                          <span className="text-sm font-medium">{item.title}</span>
                        </div>
                        <Badge
                          variant="outline"
                          className={cn("uppercase text-[10px]", statusClass(status))}
                        >
                          {status}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{item.description}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {item.evidence.length > 0
                          ? `${item.evidence.length} registered evidence ${item.evidence.length === 1 ? "item" : "items"}`
                          : "No operational evidence registered"}
                      </p>
                      <div className="mt-auto pt-2">
                        <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs">
                          {item.external ? (
                            <a href={item.target}>
                              Open <ExternalLink className="ml-1 h-3 w-3" />
                            </a>
                          ) : (
                            <Link to="/platform" search={{ page: item.target }}>
                              Open <ExternalLink className="ml-1 h-3 w-3" />
                            </Link>
                          )}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
