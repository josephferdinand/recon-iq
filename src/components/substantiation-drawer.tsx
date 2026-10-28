// Balance substantiation drawer for an EOD sign-off (P0 #2)
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScaleIcon, Plus, Trash2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import {
  listSubstantiations,
  upsertSubstantiation,
  deleteSubstantiation,
} from "@/lib/signoff.functions";

interface Props {
  signoffId: string;
  tenantId: string;
  period: string;
  canWrite: boolean;
}

export function SubstantiationDrawer({
  signoffId,
  tenantId,
  period,
  canWrite,
}: Props) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const list = useServerFn(listSubstantiations);
  const upsert = useServerFn(upsertSubstantiation);
  const del = useServerFn(deleteSubstantiation);

  const q = useQuery({
    queryKey: ["substantiations", signoffId],
    queryFn: () => list({ data: { tenant_id: tenantId, signoff_id: signoffId } }),
    enabled: open,
  });

  const mUpsert = useMutation({
    mutationFn: (row: any) => upsert({ data: row }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["substantiations", signoffId] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });
  const mDel = useMutation({
    mutationFn: (id: string) => del({ data: { id, tenant_id: tenantId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["substantiations", signoffId] });
      toast.success("Removed");
    },
  });

  const rows: any[] = q.data ?? [];
  const total = rows.length;
  const reconciled = rows.filter(
    (r) => r.status === "reconciled" || r.status === "approved",
  ).length;
  const exceptions = rows.filter((r) => r.status === "exception").length;
  const totalVariance = rows.reduce(
    (s, r) => s + Math.abs(Number(r.variance ?? 0)),
    0,
  );

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button size="sm" variant="outline">
          <ScaleIcon className="mr-2 h-3.5 w-3.5" /> Substantiations
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-3xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Balance substantiations — {period}</SheetTitle>
          <SheetDescription>
            Tie every GL balance to a supporting sub-ledger figure with
            evidence. Used by Demo Bank financial controllers to certify
            period close.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 grid grid-cols-4 gap-2 text-sm">
          <div className="rounded-md border bg-muted/30 p-3">
            <div className="text-xs text-muted-foreground">Accounts</div>
            <div className="text-xl font-semibold">{total}</div>
          </div>
          <div className="rounded-md border bg-muted/30 p-3">
            <div className="text-xs text-muted-foreground">Reconciled</div>
            <div className="text-xl font-semibold text-emerald-600">
              {reconciled}
            </div>
          </div>
          <div className="rounded-md border bg-muted/30 p-3">
            <div className="text-xs text-muted-foreground">Exceptions</div>
            <div className="text-xl font-semibold text-amber-600">
              {exceptions}
            </div>
          </div>
          <div className="rounded-md border bg-muted/30 p-3">
            <div className="text-xs text-muted-foreground">|Variance|</div>
            <div className="text-xl font-semibold">
              {totalVariance.toLocaleString(undefined, {
                maximumFractionDigits: 2,
              })}
            </div>
          </div>
        </div>

        {canWrite && (
          <div className="mt-4">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                mUpsert.mutate({
                  tenant_id: tenantId,
                  signoff_id: signoffId,
                  account_code: `GL-${Math.floor(Math.random() * 9000 + 1000)}`,
                  account_name: "Demo Bank Nostro — JPM USD",
                  currency: "USD",
                  gl_balance: 0,
                  sub_ledger_balance: 0,
                  tolerance: 0.01,
                  status: "open",
                })
              }
            >
              <Plus className="mr-2 h-3.5 w-3.5" /> Add account
            </Button>
          </div>
        )}

        <div className="mt-3 space-y-2">
          {rows.map((r) => (
            <div key={r.id} className="rounded-lg border bg-card p-3 space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div>
                  <Label className="text-[10px]">Account code</Label>
                  <Input
                    className="h-8"
                    value={r.account_code}
                    onChange={(e) =>
                      mUpsert.mutate({ ...r, account_code: e.target.value })
                    }
                    disabled={!canWrite}
                  />
                </div>
                <div className="sm:col-span-2">
                  <Label className="text-[10px]">Account name</Label>
                  <Input
                    className="h-8"
                    value={r.account_name ?? ""}
                    onChange={(e) =>
                      mUpsert.mutate({ ...r, account_name: e.target.value })
                    }
                    disabled={!canWrite}
                  />
                </div>
                <div>
                  <Label className="text-[10px]">CCY</Label>
                  <Input
                    className="h-8"
                    value={r.currency}
                    onChange={(e) =>
                      mUpsert.mutate({ ...r, currency: e.target.value })
                    }
                    disabled={!canWrite}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div>
                  <Label className="text-[10px]">GL balance</Label>
                  <Input
                    className="h-8 font-mono"
                    type="number"
                    step="0.0001"
                    value={r.gl_balance}
                    onChange={(e) =>
                      mUpsert.mutate({
                        ...r,
                        gl_balance: Number(e.target.value),
                      })
                    }
                    disabled={!canWrite}
                  />
                </div>
                <div>
                  <Label className="text-[10px]">Sub-ledger</Label>
                  <Input
                    className="h-8 font-mono"
                    type="number"
                    step="0.0001"
                    value={r.sub_ledger_balance}
                    onChange={(e) =>
                      mUpsert.mutate({
                        ...r,
                        sub_ledger_balance: Number(e.target.value),
                      })
                    }
                    disabled={!canWrite}
                  />
                </div>
                <div>
                  <Label className="text-[10px]">Tolerance</Label>
                  <Input
                    className="h-8 font-mono"
                    type="number"
                    step="0.0001"
                    value={r.tolerance}
                    onChange={(e) =>
                      mUpsert.mutate({
                        ...r,
                        tolerance: Number(e.target.value),
                      })
                    }
                    disabled={!canWrite}
                  />
                </div>
                <div>
                  <Label className="text-[10px]">Variance</Label>
                  <div className="flex h-8 items-center font-mono text-sm">
                    {Number(r.variance ?? 0).toLocaleString(undefined, {
                      maximumFractionDigits: 4,
                    })}
                    {Math.abs(Number(r.variance ?? 0)) <=
                    Number(r.tolerance ?? 0) ? (
                      <Badge variant="default" className="ml-2">
                        within
                      </Badge>
                    ) : (
                      <Badge variant="destructive" className="ml-2">
                        breach
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
              <Textarea
                rows={2}
                placeholder="Evidence link, e.g. R2://demo-bank-evidence/2026-06-26/nostro-jpm.pdf — variance is timing on T+2 wires"
                value={r.note ?? ""}
                onChange={(e) =>
                  mUpsert.mutate({ ...r, note: e.target.value })
                }
                disabled={!canWrite}
              />
              <div className="flex items-center justify-between">
                <Badge
                  variant={
                    r.status === "approved"
                      ? "default"
                      : r.status === "exception"
                        ? "destructive"
                        : "outline"
                  }
                >
                  {r.status}
                </Badge>
                {canWrite && (
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        mUpsert.mutate({ ...r, status: "reconciled" })
                      }
                    >
                      Mark reconciled
                    </Button>
                    <Button
                      size="sm"
                      onClick={() =>
                        mUpsert.mutate({ ...r, status: "approved" })
                      }
                    >
                      <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                      Certify
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => mDel.mutate(r.id)}
                      aria-label="Remove"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ))}
          {rows.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No accounts substantiated yet. Add Demo Bank Nostro / GL
              balances to certify them against sub-ledgers.
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
