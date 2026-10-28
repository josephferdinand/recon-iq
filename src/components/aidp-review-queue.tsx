/**
 * Tenant admin UI — AIDP Pending Reviews Queue
 *
 * Lists low-confidence prediction fields with the ability to accept, reject,
 * or correct each value. Every decision flows through reviewPredictionField,
 * which writes to security_events + the hash-chained audit_log. A drilldown
 * panel pulls the full audit trail for the selected prediction field
 * (`aidp.review.*` actions) so reviewers can see who touched the record and
 * when.
 */
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listPendingReviews, reviewPredictionField } from "@/lib/aidp-review.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Check, X, Pencil, Search, History } from "lucide-react";

type PendingRow = {
  id: string;
  prediction_id: string;
  confidence: number | null;
  value_text: string | null;
  value_number: number | null;
  value_date: string | null;
  value_json: unknown;
  aidp_entity_types?: { key: string; label: string; datatype: string };
  aidp_predictions?: { document_id: string };
};

export function AidpReviewQueue({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const list = useServerFn(listPendingReviews);
  const review = useServerFn(reviewPredictionField);
  const [docFilter, setDocFilter] = useState("");
  const [editing, setEditing] = useState<PendingRow | null>(null);
  const [drilldown, setDrilldown] = useState<PendingRow | null>(null);
  const [auditRows, setAuditRows] = useState<any[]>([]);
  const [correctedValue, setCorrectedValue] = useState("");
  const [notes, setNotes] = useState("");

  const queryKey = ["aidp-pending-reviews", tenantId, docFilter];
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => list({ data: {
      tenant_id: tenantId,
      ...(docFilter ? { document_id: docFilter } : {}),
      limit: 50,
    } }),
  });

  const rows = (data ?? []) as PendingRow[];

  async function submit(decision: "accept" | "reject" | "correct", row: PendingRow) {
    try {
      await review({ data: {
        prediction_field_id: row.id, decision,
        ...(decision === "correct" ? { corrected_value: correctedValue } : {}),
        ...(notes ? { notes } : {}),
      } });
      toast.success(`Field ${decision}ed`);
      setEditing(null); setCorrectedValue(""); setNotes("");
      qc.invalidateQueries({ queryKey });
    } catch (e: any) {
      toast.error(e?.message || "Review failed");
    }
  }

  async function openDrilldown(row: PendingRow) {
    setDrilldown(row);
    const { data: rows } = await supabase.from("audit_log")
      .select("id, action, actor_user_id, occurred_at, context")
      .eq("tenant_id", tenantId)
      .eq("resource_type", "aidp_prediction_fields")
      .eq("resource_id", row.id)
      .order("occurred_at", { ascending: false }).limit(50);
    setAuditRows(rows ?? []);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle>Pending AIDP Reviews</CardTitle>
          <p className="text-sm text-muted-foreground">
            Low-confidence prediction fields awaiting human verification. Decisions are audited.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Filter by document ID"
            value={docFilter}
            onChange={(e) => setDocFilter(e.target.value.trim())}
            className="w-72"
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!isLoading && rows.length === 0 && (
          <p className="text-sm text-muted-foreground">No pending reviews.</p>
        )}
        {rows.map((r) => {
          const value = r.value_text ?? r.value_number ?? r.value_date ?? (r.value_json ? JSON.stringify(r.value_json) : "—");
          const conf = r.confidence ?? 0;
          const confLabel = `${Math.round(conf * 100)}%`;
          return (
            <div key={r.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{r.aidp_entity_types?.label ?? r.aidp_entity_types?.key}</span>
                  <Badge variant="outline">{r.aidp_entity_types?.datatype}</Badge>
                  <Badge variant={conf >= 0.7 ? "secondary" : "destructive"}>{confLabel}</Badge>
                </div>
                <div className="truncate text-sm text-muted-foreground">{String(value)}</div>
                <div className="text-xs text-muted-foreground">doc: {r.aidp_predictions?.document_id}</div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => openDrilldown(r)} title="Audit trail">
                  <History className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="default" onClick={() => submit("accept", r)} title="Accept">
                  <Check className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="outline" onClick={() => {
                  setEditing(r);
                  setCorrectedValue(String(value === "—" ? "" : value));
                }} title="Correct">
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="destructive" onClick={() => submit("reject", r)} title="Reject">
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Correct value · {editing?.aidp_entity_types?.label}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={correctedValue}
              onChange={(e) => setCorrectedValue(e.target.value)}
              placeholder="Corrected value"
            />
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Reviewer notes (optional)"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={() => editing && submit("correct", editing)}>Save correction</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={!!drilldown} onOpenChange={(o) => !o && setDrilldown(null)}>
        <SheetContent className="w-[480px] sm:max-w-[480px]">
          <SheetHeader>
            <SheetTitle>Audit trail</SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-2 overflow-y-auto">
            {auditRows.length === 0 && (
              <p className="text-sm text-muted-foreground">No audit entries yet for this field.</p>
            )}
            {auditRows.map((a) => (
              <div key={a.id} className="rounded border p-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-mono">{a.action}</span>
                  <span className="text-muted-foreground">{new Date(a.occurred_at).toLocaleString()}</span>
                </div>
                <div className="mt-1 text-muted-foreground">actor: {a.actor_user_id ?? "system"}</div>
                {a.context && (
                  <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all text-[10px]">
                    {JSON.stringify(a.context, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </Card>
  );
}
