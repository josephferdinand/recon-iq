import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Activity, ShieldAlert, Bot, Zap, HeartPulse, Database, KeyRound, Radio, Clock, ArrowLeft, ExternalLink } from "lucide-react";
import { getOpsConsoleMetrics } from "@/lib/platform-consoles.functions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { OPS_CONSOLE_LINKS } from "@/lib/platform-ops-links";

export const Route = createFileRoute("/_authenticated/platform/ops-console")({
  beforeLoad: () => {
    throw redirect({ to: "/platform", search: { page: "ops-console" } });
  },
  component: () => null,
});

const ICONS: Record<string, React.ReactNode> = {
  workers: <HeartPulse className="h-4 w-4" />,
  chaos: <Zap className="h-4 w-4" />,
  dr: <Radio className="h-4 w-4" />,
  alerts: <ShieldAlert className="h-4 w-4" />,
  hitl: <Bot className="h-4 w-4" />,
  login: <Activity className="h-4 w-4" />,
  kill: <KeyRound className="h-4 w-4" />,
  backups: <Database className="h-4 w-4" />,
  sla: <Clock className="h-4 w-4" />,
};

function toneClass(tone: string) {
  switch (tone) {
    case "ok": return "border-emerald-500/40 bg-emerald-500/5";
    case "warn": return "border-amber-500/50 bg-amber-500/10";
    case "critical": return "border-destructive/60 bg-destructive/10";
    default: return "border-border";
  }
}

export function OpsConsoleContent() {
  const { data } = useSuspenseQuery({
    queryKey: ["platform-ops-console"],
    queryFn: () => getOpsConsoleMetrics(),
  });

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">


        <Link to="/platform" className="hover:text-foreground">
          <ArrowLeft className="mr-1 inline h-3.5 w-3.5" /> Platform
        </Link>
        <span>/</span>
        <span className="text-foreground">Ops console</span>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">Ops console</h1>
          <p className="text-sm text-muted-foreground">
            Consolidated SRE cockpit. Refreshed {new Date(data.generated_at).toLocaleTimeString()}.
          </p>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3">
        {data.cards.map((c: any) => {
          const link = OPS_CONSOLE_LINKS[c.key];
          return (
            <Card key={c.key} className={cn("border", toneClass(c.tone))}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between text-xs uppercase text-muted-foreground">
                  <span className="flex items-center gap-2">{ICONS[c.key]}{c.label}</span>
                  <Badge variant="outline" className="text-[10px] uppercase">{c.tone}</Badge>
                </div>
                <div className="mt-1 text-3xl font-semibold tabular-nums">{c.value}</div>
                <div className="text-xs text-muted-foreground">{c.detail}</div>
                {link ? (
                  <Button asChild variant="ghost" size="sm" className="mt-2 h-7 px-2 text-xs">
                    <Link to={link.to} search={link.search}>
                      Open {link.label} <ExternalLink className="ml-1 h-3 w-3" />
                    </Link>
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Workers by kind</CardTitle><CardDescription>Healthy / total heartbeats seen.</CardDescription></CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                <tr><th className="px-4 py-2">Worker</th><th className="px-4 py-2">Healthy</th><th className="px-4 py-2">Total</th></tr>
              </thead>
              <tbody>
                {(data.workers_by_kind as any[]).map((w) => (
                  <tr key={w.kind} className="border-b">
                    <td className="px-4 py-2 font-mono text-xs">{w.kind}</td>
                    <td className="px-4 py-2">{w.healthy}</td>
                    <td className="px-4 py-2 text-muted-foreground">{w.total}</td>
                  </tr>
                ))}
                {data.workers_by_kind.length === 0 ? (
                  <tr><td colSpan={3} className="px-4 py-6 text-center text-muted-foreground">No heartbeats reported.</td></tr>
                ) : null}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Recent open alerts</CardTitle><CardDescription>Unacknowledged security incidents.</CardDescription></CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                <tr><th className="px-4 py-2">Severity</th><th className="px-4 py-2">Fired</th><th className="px-4 py-2">Rule</th></tr>
              </thead>
              <tbody>
                {(data.open_alerts_recent as any[]).map((a) => (
                  <tr key={a.id} className="border-b">
                    <td className="px-4 py-2"><Badge variant={a.severity === "critical" ? "destructive" : "outline"}>{a.severity}</Badge></td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{a.fired_at ? new Date(a.fired_at).toLocaleString() : "—"}</td>
                    <td className="px-4 py-2 font-mono text-xs">{a.rule_id?.slice(0, 8) ?? "—"}</td>
                  </tr>
                ))}
                {data.open_alerts_recent.length === 0 ? (
                  <tr><td colSpan={3} className="px-4 py-6 text-center text-muted-foreground">All clear.</td></tr>
                ) : null}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Chaos drills — scheduled / running</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr><th className="px-4 py-2">Drill</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Scheduled for</th></tr>
            </thead>
            <tbody>
              {(data.chaos_upcoming as any[]).map((c) => (
                <tr key={c.id} className="border-b">
                  <td className="px-4 py-2">{c.name}</td>
                  <td className="px-4 py-2"><Badge>{c.status}</Badge></td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{c.scheduled_for ? new Date(c.scheduled_for).toLocaleString() : "—"}</td>
                </tr>
              ))}
              {data.chaos_upcoming.length === 0 ? (
                <tr><td colSpan={3} className="px-4 py-6 text-center text-muted-foreground">No drills scheduled.</td></tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
