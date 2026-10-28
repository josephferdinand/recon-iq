/**
 * LoansExposurePanel — Loan / collateral / sec-lending exposure dashboard.
 *
 * Aggregates outstanding, collateral coverage, LTV, top borrowers, currency
 * and status splits, then shows the underlying facility, pledge, and
 * sec-lending tables.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Banknote, ShieldCheck, TrendingUp } from "lucide-react";
import { EmptyStateAction } from "@/components/console-header";
import {
  listLoanFacilities,
  listCollateralPledges,
  listSecLendingLoans,
} from "@/lib/phase8-loan-vertical.functions";

type Facility = {
  id: string;
  facility_ref: string;
  borrower: string;
  currency: string;
  principal_amount: number;
  outstanding_amount: number;
  interest_rate_bps?: number | null;
  status: string;
  start_date?: string | null;
  maturity_date?: string | null;
};
type Pledge = {
  id: string;
  facility_id?: string | null;
  collateral_type: string;
  isin?: string | null;
  market_value?: number | null;
  haircut_pct?: number | null;
  effective_value?: number | null;
  currency?: string | null;
  as_of?: string | null;
};
type SecLoan = {
  id: string;
  trade_ref: string;
  isin?: string | null;
  quantity?: number | null;
  counterparty_lei?: string | null;
  loan_value?: number | null;
  fee_bps?: number | null;
  status: string;
};

function fmtMoney(v: number, ccy?: string): string {
  if (!v) return "—";
  const abs = Math.abs(v);
  const suffix = abs >= 1e9 ? "B" : abs >= 1e6 ? "M" : abs >= 1e3 ? "K" : "";
  const scale = abs >= 1e9 ? 1e9 : abs >= 1e6 ? 1e6 : abs >= 1e3 ? 1e3 : 1;
  return `${(v / scale).toFixed(1)}${suffix}${ccy ? " " + ccy : ""}`;
}

export function LoansExposurePanel({ tenantId }: { tenantId: string }) {
  const lf = useServerFn(listLoanFacilities);
  const lc = useServerFn(listCollateralPledges);
  const ll = useServerFn(listSecLendingLoans);

  const facQ = useQuery({ queryKey: ["p8-lf", tenantId], queryFn: () => lf({ data: { tenant_id: tenantId } }) });
  const pldQ = useQuery({ queryKey: ["p8-cp", tenantId], queryFn: () => lc({ data: { tenant_id: tenantId } }) });
  const secQ = useQuery({ queryKey: ["p8-sll", tenantId], queryFn: () => ll({ data: { tenant_id: tenantId } }) });

  const facilities = (facQ.data ?? []) as Facility[];
  const pledges = (pldQ.data ?? []) as Pledge[];
  const secLoans = (secQ.data ?? []) as SecLoan[];

  const agg = useMemo(() => {
    const outstanding = facilities.reduce((a, f) => a + Number(f.outstanding_amount ?? 0), 0);
    const principal = facilities.reduce((a, f) => a + Number(f.principal_amount ?? 0), 0);
    const collateral = pledges.reduce((a, p) => a + Number(p.effective_value ?? p.market_value ?? 0), 0);
    const ltv = collateral > 0 ? (outstanding / collateral) * 100 : 0;
    const activeCount = facilities.filter((f) => f.status === "active").length;
    const defaulted = facilities.filter((f) => f.status === "defaulted").length;
    const secOpen = secLoans.filter((l) => l.status === "open").length;
    const secValue = secLoans.reduce((a, l) => a + Number(l.loan_value ?? 0), 0);

    const byBorrower = new Map<string, number>();
    for (const f of facilities) {
      byBorrower.set(f.borrower, (byBorrower.get(f.borrower) ?? 0) + Number(f.outstanding_amount ?? 0));
    }
    const topBorrowers = Array.from(byBorrower.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    const byCcy = new Map<string, number>();
    for (const f of facilities) {
      byCcy.set(f.currency, (byCcy.get(f.currency) ?? 0) + Number(f.outstanding_amount ?? 0));
    }
    return { outstanding, principal, collateral, ltv, activeCount, defaulted, secOpen, secValue, topBorrowers, byCcy };
  }, [facilities, pledges, secLoans]);

  const loading = facQ.isLoading || pldQ.isLoading || secQ.isLoading;
  if (loading) return <Skeleton className="h-96 w-full mt-4" />;

  if (facilities.length === 0 && pledges.length === 0 && secLoans.length === 0) {
    return (
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Loans exposure</CardTitle>
          <CardDescription>Aggregated view of loan facilities, collateral pledges, and sec-lending loans.</CardDescription>
        </CardHeader>
        <CardContent>
          <EmptyStateAction
            title="No loan-vertical data yet"
            description="Ingest via master data pipelines or upsertLoanFacility / recordCollateralPledge."
            actions={[{ label: "Loan vertical docs", href: "/docs/89_loan_vertical.md" }]}
          />
        </CardContent>
      </Card>
    );
  }

  const ltvTone = agg.ltv < 60 ? "text-emerald-600" : agg.ltv < 85 ? "text-amber-600" : "text-rose-600";

  return (
    <div className="space-y-4 pt-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Outstanding" value={fmtMoney(agg.outstanding)} hint={`${facilities.length} facilities · ${agg.activeCount} active`} icon={Banknote} />
        <Kpi label="Collateral effective" value={fmtMoney(agg.collateral)} hint={`${pledges.length} pledges`} icon={ShieldCheck} />
        <Kpi label="Portfolio LTV" value={`${agg.ltv.toFixed(1)}%`} hint={agg.ltv > 85 ? "over threshold" : "within threshold"} toneClass={ltvTone} icon={TrendingUp} />
        <Kpi label="Sec-lending" value={fmtMoney(agg.secValue)} hint={`${agg.secOpen}/${secLoans.length} open`} icon={Banknote} />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Top borrowers</CardTitle></CardHeader>
          <CardContent>
            {agg.topBorrowers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No borrowers.</p>
            ) : (
              <div className="space-y-2">
                {agg.topBorrowers.map(([borrower, amt]) => {
                  const pct = agg.outstanding > 0 ? (amt / agg.outstanding) * 100 : 0;
                  return (
                    <div key={borrower}>
                      <div className="flex justify-between text-xs">
                        <span className="truncate max-w-[16rem]">{borrower}</span>
                        <span className="font-mono">{fmtMoney(amt)} · {pct.toFixed(1)}%</span>
                      </div>
                      <div className="h-1.5 rounded bg-muted overflow-hidden">
                        <div className="h-full bg-primary" style={{ width: `${Math.min(100, pct)}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">By currency</CardTitle></CardHeader>
          <CardContent>
            {agg.byCcy.size === 0 ? (
              <p className="text-sm text-muted-foreground">No facilities.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {Array.from(agg.byCcy.entries()).map(([ccy, v]) => (
                  <Badge key={ccy} variant="outline" className="font-mono">
                    {ccy} · {fmtMoney(v)}
                  </Badge>
                ))}
              </div>
            )}
            {agg.defaulted > 0 && (
              <p className="mt-3 text-xs text-rose-600">{agg.defaulted} defaulted facilities require review.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Card><CardHeader><CardTitle className="text-base">Loan facilities</CardTitle></CardHeader><CardContent>
          <MiniTable rows={facilities.slice(0, 20).map((f) => [f.facility_ref, f.borrower, `${fmtMoney(f.outstanding_amount, f.currency)}`, f.status])}
                     cols={["ref", "borrower", "outstanding", "status"]} empty="No facilities." />
        </CardContent></Card>
        <Card><CardHeader><CardTitle className="text-base">Collateral pledges</CardTitle></CardHeader><CardContent>
          <MiniTable rows={pledges.slice(0, 20).map((p) => [p.collateral_type, p.isin ?? "—", fmtMoney(Number(p.effective_value ?? p.market_value ?? 0), p.currency ?? undefined), `${p.haircut_pct ?? 0}%`])}
                     cols={["type", "isin", "effective", "hc"]} empty="No pledges." />
        </CardContent></Card>
        <Card><CardHeader><CardTitle className="text-base">Sec-lending loans</CardTitle></CardHeader><CardContent>
          <MiniTable rows={secLoans.slice(0, 20).map((l) => [l.trade_ref, l.isin ?? "—", fmtMoney(Number(l.loan_value ?? 0)), l.status])}
                     cols={["trade", "isin", "value", "status"]} empty="No sec-lending loans." />
        </CardContent></Card>
      </div>
    </div>
  );
}

function Kpi({ label, value, hint, icon: Icon, toneClass }: { label: string; value: string; hint?: string; icon: React.ComponentType<{ className?: string }>; toneClass?: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center justify-between">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
        <p className={`text-xl font-semibold mt-1 ${toneClass ?? ""}`}>{value}</p>
        {hint && <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function MiniTable({ cols, rows, empty }: { cols: string[]; rows: Array<Array<string | number>>; empty: string }) {
  if (rows.length === 0) return <p className="text-xs text-muted-foreground">{empty}</p>;
  return (
    <table className="w-full text-[11px]">
      <thead><tr className="text-left text-muted-foreground">{cols.map((c) => <th key={c} className="py-1 pr-2 font-normal">{c}</th>)}</tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-t">
            {r.map((v, j) => <td key={j} className="py-1 pr-2 truncate max-w-[12rem]">{v}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
