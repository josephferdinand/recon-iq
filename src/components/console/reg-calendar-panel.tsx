/**
 * RegCalendarPanel — Regulatory calendar for the Vertical Console.
 * Derives upcoming deadlines from installed regulatory packs, lets users
 * subscribe to per-event alerts and one-click generate a fresh recon pack.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BellPlus, PackagePlus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { EmptyStateAction } from "@/components/console-header";
import { listTenantPackInstalls, rematerializeRegulatoryInstall } from "@/lib/regulatory.functions";
import {
  subscribeRegCalendarAlert,
  findInstallForRegulation,
  logRegPackGeneration,
} from "@/lib/reg-calendar.functions";

type Install = {
  id: string;
  installed_version?: string | null;
  installed_at: string;
  status: string;
  materialized_at?: string | null;
  pack?: { code?: string; title?: string; regulation?: string } | null;
};

// Static deadline map — real deadlines usually come from the pack definition;
// this table gives an anchor date per regulation until pack.definition surfaces them.
const REG_CALENDAR: Record<string, Array<{ label: string; recurrence: string; nextDue: (now: Date) => Date }>> = {
  EMIR: [{ label: "T+1 trade reporting", recurrence: "daily", nextDue: (n) => nextBusinessDay(n) }],
  MiFID: [{ label: "T+1 transaction reporting (ARM)", recurrence: "daily", nextDue: (n) => nextBusinessDay(n) }],
  SFTR: [{ label: "T+1 SFT reporting", recurrence: "daily", nextDue: (n) => nextBusinessDay(n) }],
  CAT: [{ label: "FINRA CAT reporting", recurrence: "daily", nextDue: (n) => nextBusinessDay(n) }],
  Basel: [{ label: "Quarterly RWA return", recurrence: "quarterly", nextDue: nextQuarterEnd }],
  IFRS9: [{ label: "Monthly ECL close", recurrence: "monthly", nextDue: nextMonthEnd }],
  FRTB: [{ label: "IMA/SA capital submission", recurrence: "monthly", nextDue: nextMonthEnd }],
  DORA: [{ label: "TLPT quarterly evidence", recurrence: "quarterly", nextDue: nextQuarterEnd }],
};

function nextBusinessDay(now: Date): Date {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d;
}
function nextMonthEnd(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth() + 1, 0);
}
function nextQuarterEnd(now: Date): Date {
  const q = Math.floor(now.getMonth() / 3);
  return new Date(now.getFullYear(), (q + 1) * 3, 0);
}

export function RegCalendarPanel({ tenantId }: { tenantId: string }) {
  const lst = useServerFn(listTenantPackInstalls);
  const q = useQuery({
    queryKey: ["reg-cal", tenantId],
    queryFn: () => lst({ data: { tenant_id: tenantId } }),
  });

  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  const installs = (q.data ?? []) as Install[];

  if (installs.length === 0) {
    return (
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Regulatory calendar</CardTitle>
          <CardDescription>Upcoming submission deadlines, derived from installed regulatory packs.</CardDescription>
        </CardHeader>
        <CardContent>
          <EmptyStateAction
            title="No regulatory packs installed"
            description="Install packs like EMIR, MiFID II, SFTR, FINRA CAT, Basel III or IFRS 9 to auto-populate deadlines and reports."
            actions={[
              { label: "Browse marketplace", href: "../marketplace", variant: "default" },
              { label: "Regulatory packs guide", href: "/docs/15_regulatory_packs.md" },
            ]}
          />
        </CardContent>
      </Card>
    );
  }

  const now = new Date();
  const upcoming: Array<{ pack: string; regulation: string; label: string; recurrence: string; nextDue: Date; daysLeft: number }> = [];
  installs.forEach((i) => {
    const reg = i.pack?.regulation ?? "";
    // fuzzy match regulation → calendar key
    const key = Object.keys(REG_CALENDAR).find((k) => reg.toUpperCase().includes(k));
    if (!key) return;
    REG_CALENDAR[key].forEach((entry) => {
      const nextDue = entry.nextDue(now);
      const daysLeft = Math.max(0, Math.ceil((nextDue.getTime() - now.getTime()) / 86_400_000));
      upcoming.push({ pack: i.pack?.title ?? i.pack?.code ?? "pack", regulation: reg, label: entry.label, recurrence: entry.recurrence, nextDue, daysLeft });
    });
  });
  upcoming.sort((a, b) => a.nextDue.getTime() - b.nextDue.getTime());

  const overdue = upcoming.filter((u) => u.daysLeft <= 1).length;
  const thisWeek = upcoming.filter((u) => u.daysLeft > 1 && u.daysLeft <= 7).length;
  const thisMonth = upcoming.filter((u) => u.daysLeft > 7 && u.daysLeft <= 30).length;

  return (
    <div className="space-y-4 pt-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="Packs installed" value={installs.length} />
        <Tile label="Due within 1d" value={overdue} tone={overdue > 0 ? "danger" : "positive"} />
        <Tile label="Due this week" value={thisWeek} tone={thisWeek > 0 ? "warning" : "default"} />
        <Tile label="Due this month" value={thisMonth} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Upcoming submissions</CardTitle>
          <CardDescription>Ordered by next due date. Recurrence derived from the regulation.</CardDescription>
        </CardHeader>
        <CardContent>
          {upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No deadlines mapped for installed packs — regulation field on packs may not match the calendar template. Extend <code>REG_CALENDAR</code> in <code>reg-calendar-panel.tsx</code>.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1">Submission</th><th>Regulation</th><th>Recurrence</th><th className="text-right">Due</th><th className="text-right">Days left</th><th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {upcoming.map((u, i) => (
                  <tr key={i} className="border-t">
                    <td className="py-1">{u.label}</td>
                    <td><Badge variant="outline">{u.regulation}</Badge></td>
                    <td className="text-xs text-muted-foreground">{u.recurrence}</td>
                    <td className="text-right whitespace-nowrap">{u.nextDue.toLocaleDateString()}</td>
                    <td className={`text-right font-mono ${u.daysLeft <= 1 ? "text-rose-500" : u.daysLeft <= 7 ? "text-amber-500" : ""}`}>{u.daysLeft}d</td>
                    <td className="text-right">
                      <EventActions
                        tenantId={tenantId}
                        regulation={u.regulation}
                        label={u.label}
                        dueAt={u.nextDue.toISOString()}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function EventActions({
  tenantId,
  regulation,
  label,
  dueAt,
}: {
  tenantId: string;
  regulation: string;
  label: string;
  dueAt: string;
}) {
  const qc = useQueryClient();
  const subscribe = useServerFn(subscribeRegCalendarAlert);
  const findInstall = useServerFn(findInstallForRegulation);
  const rematerialize = useServerFn(rematerializeRegulatoryInstall);
  const logGen = useServerFn(logRegPackGeneration);
  const [busy, setBusy] = useState<null | "alert" | "pack">(null);

  const alertMut = useMutation({
    mutationFn: () =>
      subscribe({ data: { tenant_id: tenantId, regulation, label, due_at: dueAt, days_before: 1 } }),
    onMutate: () => setBusy("alert"),
    onSettled: () => setBusy(null),
    onSuccess: () => {
      toast.success(`Alert set for ${label}`, { description: "You'll be notified 1 day before due." });
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (e: unknown) => toast.error("Could not set alert", { description: (e as Error).message }),
  });

  const packMut = useMutation({
    mutationFn: async () => {
      const install = (await findInstall({ data: { tenant_id: tenantId, regulation } })) as
        | { install_id: string; pack_code: string | null; pack_title: string | null }
        | null;
      if (!install) throw new Error(`No installed pack for ${regulation}. Install it first from the marketplace.`);
      const result = (await rematerialize({
        data: { install_id: install.install_id, tenant_id: tenantId },
      })) as { recon_id: string };
      await logGen({
        data: {
          tenant_id: tenantId,
          install_id: install.install_id,
          recon_id: result.recon_id,
          regulation,
          label,
          due_at: dueAt,
          pack_code: install.pack_code,
        },
      });
      return { ...install, recon_id: result.recon_id };
    },
    onMutate: () => setBusy("pack"),
    onSettled: () => setBusy(null),
    onSuccess: (r) => {
      toast.success(`Recon pack generated`, {
        description: `${r.pack_title ?? r.pack_code ?? regulation} · recon ${r.recon_id.slice(0, 8)}…`,
      });
      qc.invalidateQueries({ queryKey: ["packs-installs", tenantId] });
    },
    onError: (e: unknown) => toast.error("Pack generation failed", { description: (e as Error).message }),
  });

  return (
    <div className="inline-flex gap-1">
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2"
        disabled={busy !== null}
        onClick={() => alertMut.mutate()}
        title="Set an alert 1 day before this deadline"
      >
        {busy === "alert" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BellPlus className="h-3.5 w-3.5" />}
        <span className="ml-1 text-xs">Alert</span>
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="h-7 px-2"
        disabled={busy !== null}
        onClick={() => packMut.mutate()}
        title="Generate a fresh reconciliation pack for this submission"
      >
        {busy === "pack" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PackagePlus className="h-3.5 w-3.5" />}
        <span className="ml-1 text-xs">Generate pack</span>
      </Button>
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string | number; tone?: "positive" | "warning" | "danger" | "default" }) {
  const toneClass = tone === "positive" ? "text-emerald-600 dark:text-emerald-400" : tone === "warning" ? "text-amber-600 dark:text-amber-400" : tone === "danger" ? "text-rose-600 dark:text-rose-400" : "text-foreground";
  return (
    <div className="rounded-md border p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-xl font-semibold mt-1 ${toneClass}`}>{value}</p>
    </div>
  );
}
