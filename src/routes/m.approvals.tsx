import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CheckCircle2, XCircle, Clock, ShieldCheck, ChevronRight, Smartphone, AlertTriangle } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/m/approvals")({
  component: MobileApprovals,
});

type PendingItem = {
  id: string;
  kind: "signoff" | "config-change" | "manual-match" | "promotion" | "agent-action";
  title: string;
  subtitle: string;
  tenant_slug?: string | null;
  amount?: string | null;
  age_minutes?: number | null;
  severity?: "low" | "medium" | "high" | "critical";
  target_route?: string;
};

async function loadPending(): Promise<PendingItem[]> {
  const { data: session } = await supabase.auth.getSession();
  if (!session.session) return [];

  // Aggregate: pending sign-offs, config change requests, manual match approvals
  const [signoffs, configReqs, matches] = await Promise.all([
    supabase.from("eod_signoffs")
      .select("id, recon_id, status, created_at, tenant_id")
      .in("status", ["submitted", "in_review"]).limit(25),
    supabase.from("config_change_requests")
      .select("id, change_type, target_table, status, requested_by, created_at, tenant_id, risk_score")
      .eq("status", "pending").limit(25),
    supabase.from("manual_match_approvals")
      .select("id, status, created_at, tenant_id, reference")
      .eq("status", "pending").limit(25),
  ]);

  const items: PendingItem[] = [];
  signoffs.data?.forEach((s: any) => items.push({
    id: s.id, kind: "signoff",
    title: "End-of-day sign-off",
    subtitle: `Recon ${String(s.recon_id ?? "").slice(0, 8)}`,
    age_minutes: minutesSince(s.created_at),
    severity: "high",
    target_route: "/",
  }));
  configReqs.data?.forEach((c: any) => items.push({
    id: c.id, kind: "config-change",
    title: `${c.change_type} on ${c.target_table}`,
    subtitle: `Risk score ${c.risk_score ?? "—"}`,
    age_minutes: minutesSince(c.created_at),
    severity: (c.risk_score ?? 0) > 70 ? "critical" : "medium",
    target_route: "/",
  }));
  matches.data?.forEach((m: any) => items.push({
    id: m.id, kind: "manual-match",
    title: "Manual match approval",
    subtitle: m.reference ?? "—",
    age_minutes: minutesSince(m.created_at),
    severity: "low",
    target_route: "/",
  }));
  return items.sort((a, b) => (b.age_minutes ?? 0) - (a.age_minutes ?? 0));
}

function minutesSince(ts: string | null): number {
  if (!ts) return 0;
  return Math.round((Date.now() - new Date(ts).getTime()) / 60000);
}

function ageLabel(min: number): string {
  if (min < 60) return `${min}m`;
  if (min < 1440) return `${Math.round(min / 60)}h`;
  return `${Math.round(min / 1440)}d`;
}

const SEVERITY_COLOR: Record<string, string> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  high: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  critical: "bg-red-500/10 text-red-700 dark:text-red-300",
};

function MobileApprovals() {
  const qc = useQueryClient();
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setAuthed(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setAuthed(!!s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["mobile-approvals"],
    queryFn: loadPending,
    enabled: authed === true,
    refetchInterval: 30_000,
  });

  const approveSignoff = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("eod_signoffs").update({ status: "approved", approved_at: new Date().toISOString() } as any).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Approved"); qc.invalidateQueries({ queryKey: ["mobile-approvals"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });
  const rejectSignoff = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("eod_signoffs").update({ status: "rejected" } as any).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Rejected"); qc.invalidateQueries({ queryKey: ["mobile-approvals"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  if (authed === false) {
    return (
      <div className="min-h-screen grid place-items-center bg-background p-6">
        <Card className="max-w-sm w-full">
          <CardContent className="p-6 text-center space-y-3">
            <Smartphone className="h-10 w-10 mx-auto text-primary" />
            <h1 className="text-lg font-semibold">ReconIQ Approver</h1>
            <p className="text-sm text-muted-foreground">Sign in to review pending approvals on the go.</p>
            <Button asChild className="w-full"><Link to="/auth">Sign in</Link></Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur px-4 py-3 flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-primary" />
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-semibold truncate">Approvals</h1>
          <p className="text-xs text-muted-foreground">{items.length} pending · auto-refresh 30s</p>
        </div>
        <Badge variant="outline" className="text-[10px]">Mobile</Badge>
      </header>

      <ScrollArea className="h-[calc(100vh-56px)]">
        <div className="p-3 space-y-2">
          {isLoading ? (
            <div className="text-center text-sm text-muted-foreground py-12">Loading…</div>
          ) : items.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <CheckCircle2 className="h-10 w-10 mx-auto opacity-30 mb-2" />
              <p className="text-sm">Nothing pending. All clear.</p>
            </div>
          ) : items.map((it) => (
            <Card key={`${it.kind}:${it.id}`} className="overflow-hidden">
              <CardContent className="p-3 space-y-3">
                <div className="flex items-start gap-2">
                  <div className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${SEVERITY_COLOR[it.severity ?? "low"]}`}>
                    {it.kind}
                  </div>
                  <div className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {ageLabel(it.age_minutes ?? 0)}
                  </div>
                </div>
                <div>
                  <p className="font-medium text-sm leading-snug">{it.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{it.subtitle}</p>
                </div>
                <div className="flex items-center gap-2">
                  {it.kind === "signoff" ? (
                    <>
                      <Button
                        size="sm"
                        className="flex-1"
                        onClick={() => approveSignoff.mutate(it.id)}
                        disabled={approveSignoff.isPending}
                      >
                        <CheckCircle2 className="h-4 w-4 mr-1" />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1"
                        onClick={() => rejectSignoff.mutate(it.id)}
                        disabled={rejectSignoff.isPending}
                      >
                        <XCircle className="h-4 w-4 mr-1" />
                        Reject
                      </Button>
                    </>
                  ) : (
                    <Button asChild size="sm" variant="outline" className="flex-1">
                      <Link to="/">
                        Open in desktop
                        <ChevronRight className="h-3 w-3 ml-1" />
                      </Link>
                    </Button>
                  )}
                </div>
                {it.severity === "critical" && (
                  <div className="flex items-center gap-1 text-xs text-red-700 dark:text-red-300">
                    <AlertTriangle className="h-3 w-3" />
                    High-risk change — verify before approving.
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
