import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  assignException, writeOffException, closeException, reopenException,
  setReviewState, setExceptionLabels, listExceptionTransitions,
  listBreakWriteOffRequests, decideBreakWriteOff,
} from "@/lib/nrl.functions";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

/**
 * ExceptionLifecycleDialog — Duco-parity break actions:
 *   Assign · Review state · Labels · Write-off · Close · Reopen · History.
 * Mounts on top of any exception row in the workspace.
 */
export function ExceptionLifecycleDialog({
  open, onOpenChange, tenantId, exceptionId, currentStatus,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tenantId: string;
  exceptionId: string;
  currentStatus?: string;
}) {
  const qc = useQueryClient();
  const assign = useServerFn(assignException);
  const writeOff = useServerFn(writeOffException);
  const close = useServerFn(closeException);
  const reopen = useServerFn(reopenException);
  const review = useServerFn(setReviewState);
  const labels = useServerFn(setExceptionLabels);
  const listTransitions = useServerFn(listExceptionTransitions);
  const listWriteOffs = useServerFn(listBreakWriteOffRequests);
  const decideWriteOff = useServerFn(decideBreakWriteOff);

  const history = useQuery({
    queryKey: ["exc-transitions", exceptionId],
    queryFn: () => listTransitions({ data: { tenant_id: tenantId, exception_id: exceptionId } }),
    enabled: open,
  });
  const writeOffs = useQuery({
    queryKey: ["break-write-offs", exceptionId],
    queryFn: () => listWriteOffs({ data: { tenant_id: tenantId, exception_id: exceptionId } }),
    enabled: open,
  });

  const [assigneeId, setAssigneeId] = useState("");
  const [reviewVal, setReviewVal] = useState<"unreviewed" | "under_review" | "reviewed">("under_review");
  const [labelsTxt, setLabelsTxt] = useState("");
  const [wo, setWo] = useState({ amount: "", currency: "USD", gl_account: "", reason: "" });
  const [closeReason, setCloseReason] = useState("");
  const [reopenReason, setReopenReason] = useState("");

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["exc-transitions", exceptionId] });
    qc.invalidateQueries({ queryKey: ["exceptions"] });
    qc.invalidateQueries({ queryKey: ["break-write-offs", exceptionId] });
  };

  const run = async <T,>(p: Promise<T>, msg: string) => {
    try { await p; toast.success(msg); invalidate(); }
    catch (e) { toast.error((e as Error).message); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Break actions</DialogTitle>
          <DialogDescription>
            Manage lifecycle — assign, review, label, write-off, close, reopen. All actions are audit-chained.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="assign">
          <TabsList className="grid grid-cols-6 w-full">
            <TabsTrigger value="assign">Assign</TabsTrigger>
            <TabsTrigger value="review">Review</TabsTrigger>
            <TabsTrigger value="labels">Labels</TabsTrigger>
            <TabsTrigger value="writeoff">Write-off</TabsTrigger>
            <TabsTrigger value="close">Close / Reopen</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          <TabsContent value="assign" className="space-y-2 pt-3">
            <Label>Assignee user ID</Label>
            <Input value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}
              placeholder="e.g. 9c8b7a6e-1234-…-demo-bank-cash-ops-lead" />
            <div className="flex gap-2 pt-2">
              <Button onClick={() => run(
                assign({ data: { tenant_id: tenantId, exception_id: exceptionId, assignee: assigneeId || null } }),
                assigneeId ? "Assigned" : "Unassigned"
              )}>Assign</Button>
              <Button variant="outline" onClick={() => { setAssigneeId(""); run(
                assign({ data: { tenant_id: tenantId, exception_id: exceptionId, assignee: null } }),
                "Unassigned"
              ); }}>Unassign</Button>
            </div>
          </TabsContent>

          <TabsContent value="review" className="space-y-2 pt-3">
            <Label>Review state</Label>
            <Select value={reviewVal} onValueChange={(v) => setReviewVal(v as typeof reviewVal)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="unreviewed">Unreviewed</SelectItem>
                <SelectItem value="under_review">Under review</SelectItem>
                <SelectItem value="reviewed">Reviewed</SelectItem>
              </SelectContent>
            </Select>
            <Button className="mt-2" onClick={() => run(
              review({ data: { tenant_id: tenantId, exception_id: exceptionId, review_state: reviewVal } }),
              "Review state updated"
            )}>Set state</Button>
          </TabsContent>

          <TabsContent value="labels" className="space-y-2 pt-3">
            <Label>Comma-separated labels</Label>
            <Input value={labelsTxt} onChange={(e) => setLabelsTxt(e.target.value)}
              placeholder="e.g. demo-bank-fx-timing, demo-bank-late-feed, demo-bank-treasury-review" />
            <Button className="mt-2" onClick={() => {
              const arr = labelsTxt.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 20);
              run(labels({ data: { tenant_id: tenantId, exception_id: exceptionId, labels: arr } }), "Labels updated");
            }}>Save labels</Button>
          </TabsContent>

          <TabsContent value="writeoff" className="space-y-2 pt-3">
            <div className="grid grid-cols-3 gap-2">
              <div><Label>Amount</Label><Input type="number" value={wo.amount}
                onChange={(e) => setWo({ ...wo, amount: e.target.value })} /></div>
              <div><Label>Currency</Label><Input value={wo.currency}
                onChange={(e) => setWo({ ...wo, currency: e.target.value })} /></div>
              <div><Label>GL account</Label><Input value={wo.gl_account}
                onChange={(e) => setWo({ ...wo, gl_account: e.target.value })} /></div>
            </div>
            <Label>Reason</Label>
            <Textarea value={wo.reason} onChange={(e) => setWo({ ...wo, reason: e.target.value })} />
            <Button className="mt-2" variant="destructive" onClick={() => run(
              writeOff({ data: {
                tenant_id: tenantId, exception_id: exceptionId,
                amount: Number(wo.amount), currency: wo.currency,
                gl_account: wo.gl_account, reason: wo.reason,
              } }),
              "Write-off submitted for independent approval"
            )}>Request write-off</Button>
            <p className="text-xs text-muted-foreground">
              A different active tenant administrator must approve or reject every write-off.
            </p>
            {(writeOffs.data ?? []).filter((request) => request.status === "pending").map((request) => (
              <div key={request.id} className="rounded-md border p-3 text-sm space-y-2">
                <div className="font-medium">Pending {request.currency} {Number(request.amount).toFixed(2)}</div>
                <div className="text-muted-foreground">{request.reason}</div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => run(decideWriteOff({ data: {
                    tenant_id: tenantId, request_id: request.id, decision: "approved",
                  } }), "Write-off approved by independent checker")}>Approve</Button>
                  <Button size="sm" variant="outline" onClick={() => run(decideWriteOff({ data: {
                    tenant_id: tenantId, request_id: request.id, decision: "rejected",
                  } }), "Write-off rejected")}>Reject</Button>
                </div>
              </div>
            ))}
          </TabsContent>

          <TabsContent value="close" className="space-y-3 pt-3">
            <div>
              <Label>Close reason</Label>
              <Textarea value={closeReason} onChange={(e) => setCloseReason(e.target.value)} />
              <Button className="mt-2" disabled={currentStatus === "resolved"} onClick={() => run(
                close({ data: { tenant_id: tenantId, exception_id: exceptionId, reason: closeReason } }),
                "Closed"
              )}>Close break</Button>
            </div>
            <div>
              <Label>Reopen reason</Label>
              <Textarea value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} />
              <Button className="mt-2" variant="outline" onClick={() => run(
                reopen({ data: { tenant_id: tenantId, exception_id: exceptionId, reason: reopenReason } }),
                "Reopened"
              )}>Reopen</Button>
            </div>
          </TabsContent>

          <TabsContent value="history" className="space-y-2 pt-3">
            {history.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> :
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {(history.data ?? []).map((h: { id: string; from_state: string | null; to_state: string; transition_type: string; reason: string | null; occurred_at: string }) => (
                  <div key={h.id} className="rounded-md border p-2 text-sm">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{h.transition_type}</Badge>
                      <span className="text-muted-foreground">
                        {h.from_state ?? "·"} → <strong>{h.to_state}</strong>
                      </span>
                      <span className="ml-auto text-xs text-muted-foreground">
                        {new Date(h.occurred_at).toLocaleString()}
                      </span>
                    </div>
                    {h.reason && <p className="text-xs text-muted-foreground mt-1">{h.reason}</p>}
                  </div>
                ))}
                {(history.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">No history yet. Example: Demo Bank Nostro USD break #4821 — opened → investigating → resolved.</p>}
              </div>
            }
          </TabsContent>
        </Tabs>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
