import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listProposedAgentActions, approveAgentAction, rejectAgentAction,
  bulkApproveAgentActions, bulkRejectAgentActions,
} from "@/lib/agent-review.functions";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Inbox, CheckCircle2, XCircle, FileDiff, ShieldCheck, Clock, Radio,
} from "lucide-react";
import { toast } from "sonner";
import { AgentActionTimeline } from "@/components/agent-action-timeline";
import { KbApprovalDiff } from "@/components/kb-approval-diff";

function StatusBadge({ s }: { s: string }) {
  if (s === "pending")   return <Badge variant="secondary"><Clock className="mr-1 h-3 w-3" />Pending</Badge>;
  if (s === "approved" || s === "completed")
                         return <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400 hover:bg-emerald-600"><CheckCircle2 className="mr-1 h-3 w-3" />Approved</Badge>;
  if (s === "rejected")  return <Badge variant="destructive"><XCircle className="mr-1 h-3 w-3" />Rejected</Badge>;
  return <Badge variant="outline">{s}</Badge>;
}

function CeilingBadge({ c }: { c?: string | null }) {
  if (!c) return null;
  const color = c === "auto" ? "bg-rose-100 text-rose-900" : c === "assist" ? "bg-amber-100 text-amber-900" : "bg-sky-100 text-sky-900";
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${color}`}>{c}</span>;
}

function DiffPreview({ tenantId, actionId, tool, before, input }: { tenantId: string; actionId: string; tool: string; before: any; input: any }) {
  if (tool.startsWith("kb_article_")) {
    return <KbApprovalDiff tenantId={tenantId} actionId={actionId} />;
  }
  if (tool === "set_break_lifecycle" && before) {
    const rows: Array<[string, any, any]> = [
      ["lifecycle_state", before.lifecycle_state, input.lifecycle_state],
      ["root_cause", before.root_cause ?? "—", input.root_cause ?? "—"],
    ];
    return (
      <table className="w-full text-xs">
        <thead className="bg-muted/40 text-left text-[10px] uppercase text-muted-foreground">
          <tr><th className="px-2 py-1">Field</th><th className="px-2 py-1">Before</th><th className="px-2 py-1">After</th></tr>
        </thead>
        <tbody>
          {rows.map(([k, a, b]) => (
            <tr key={k} className="border-t">
              <td className="px-2 py-1 font-medium">{k}</td>
              <td className="px-2 py-1 text-rose-700 line-through">{String(a ?? "—")}</td>
              <td className="px-2 py-1 text-emerald-700">{String(b ?? "—")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  if (tool === "add_break_comment") {
    return (
      <div className="text-xs">
        <div className="text-[10px] uppercase text-muted-foreground">New internal comment</div>
        <div className="mt-1 rounded border bg-emerald-50 p-2 text-emerald-900">{input.body}</div>
      </div>
    );
  }
  return (
    <pre className="overflow-x-auto rounded bg-muted/40 p-2 text-[11px]">{JSON.stringify({ before, input }, null, 2)}</pre>
  );
}

type BulkMode = "approve" | "reject" | null;

export function AgentReviewQueue({ tenantId, canApprove }: { tenantId: string; canApprove: boolean }) {
  const qc = useQueryClient();
  const list = useServerFn(listProposedAgentActions);
  const approveFn = useServerFn(approveAgentAction);
  const rejectFn = useServerFn(rejectAgentAction);
  const bulkApproveFn = useServerFn(bulkApproveAgentActions);
  const bulkRejectFn = useServerFn(bulkRejectAgentActions);

  const [openId, setOpenId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  // Bulk state
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkMode, setBulkMode] = useState<BulkMode>(null);
  const [bulkNotes, setBulkNotes] = useState<Record<string, string>>({});

  // Realtime
  const [live, setLive] = useState(false);

  const queryKey = ["agent-review-queue", tenantId];
  const q = useQuery({
    queryKey,
    queryFn: () => list({ data: { tenant_id: tenantId, limit: 100 } }),
    refetchInterval: live ? false : 8000, // realtime takes over when subscribed
  });

  useEffect(() => {
    const ch = supabase
      .channel(`agent-actions-${tenantId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "agent_actions", filter: `tenant_id=eq.${tenantId}` },
        () => { qc.invalidateQueries({ queryKey }); },
      )
      .subscribe((status) => { if (status === "SUBSCRIBED") setLive(true); });
    return () => { supabase.removeChannel(ch); setLive(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const approve = useMutation({
    mutationFn: (action_id: string) => approveFn({ data: { tenant_id: tenantId, action_id } }),
    onSuccess: () => { toast.success("Approved & executed. Reversal token recorded."); qc.invalidateQueries({ queryKey }); },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  const reject = useMutation({
    mutationFn: (vars: { action_id: string; reason: string }) =>
      rejectFn({ data: { tenant_id: tenantId, action_id: vars.action_id, reason: vars.reason } }),
    onSuccess: () => {
      toast.success("Rejected"); setRejectingId(null); setReason("");
      qc.invalidateQueries({ queryKey });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  const bulkApprove = useMutation({
    mutationFn: (items: { action_id: string; note?: string }[]) =>
      bulkApproveFn({ data: { tenant_id: tenantId, items } }),
    onSuccess: (r: any) => {
      toast.success(`Bulk approve: ${r.succeeded} succeeded, ${r.failed} failed`);
      resetBulk(); qc.invalidateQueries({ queryKey });
    },
    onError: (e: any) => toast.error(e?.message ?? "Bulk approve failed"),
  });

  const bulkReject = useMutation({
    mutationFn: (items: { action_id: string; note: string }[]) =>
      bulkRejectFn({ data: { tenant_id: tenantId, items } }),
    onSuccess: (r: any) => {
      toast.success(`Bulk reject: ${r.succeeded} succeeded, ${r.failed} failed`);
      resetBulk(); qc.invalidateQueries({ queryKey });
    },
    onError: (e: any) => toast.error(e?.message ?? "Bulk reject failed"),
  });

  const rows = (q.data ?? []) as any[];
  const pending = useMemo(() => rows.filter((r) => r.status === "pending"), [rows]);
  const allSelected = pending.length > 0 && pending.every((r) => selected.has(r.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(pending.map((r) => r.id)));
  }
  function resetBulk() {
    setSelected(new Set()); setBulkMode(null); setBulkNotes({});
  }

  const selectedRows = pending.filter((r) => selected.has(r.id));
  const bulkValid =
    bulkMode === "approve"
      ? selectedRows.length > 0
      : selectedRows.length > 0 && selectedRows.every((r) => (bulkNotes[r.id]?.trim().length ?? 0) >= 3);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Inbox className="h-4 w-4 text-primary" /> Agent review queue
          {pending.length > 0 && <Badge variant="secondary">{pending.length} pending</Badge>}
          {live && (
            <Badge variant="outline" className="ml-1 gap-1 border-emerald-300 text-emerald-700">
              <Radio className="h-3 w-3 animate-pulse" /> Live
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Plan-mode proposals from the ReconIQ agent. Review the diff, then approve (executes the change and mints a reversal token)
          or reject with a reason. Approvers must be tenant admins (separation of duties from the agent runner).
        </CardDescription>
      </CardHeader>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center justify-between border-y bg-primary/5 px-4 py-2 text-sm">
          <div className="flex items-center gap-2">
            <Badge>{selected.size} selected</Badge>
            <Button size="sm" variant="ghost" onClick={resetBulk}>Clear</Button>
          </div>
          <div className="flex gap-2">
            <Button size="sm" disabled={!canApprove} onClick={() => setBulkMode("approve")}>
              <ShieldCheck className="mr-1 h-3 w-3" /> Bulk approve
            </Button>
            <Button size="sm" variant="destructive" disabled={!canApprove} onClick={() => setBulkMode("reject")}>
              Bulk reject
            </Button>
          </div>
        </div>
      )}

      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="w-8 px-3 py-2">
                <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Select all pending" />
              </th>
              <th className="px-4 py-2">When</th>
              <th className="px-4 py-2">Tool</th>
              <th className="px-4 py-2">Ceiling</th>
              <th className="px-4 py-2">Run objective</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b hover:bg-muted/20">
                <td className="px-3 py-2">
                  {r.status === "pending" && (
                    <Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggle(r.id)} aria-label="Select action" />
                  )}
                </td>
                <td className="px-4 py-2 text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</td>
                <td className="px-4 py-2 font-mono text-xs">{r.tool}</td>
                <td className="px-4 py-2"><CeilingBadge c={r.policy_ceiling} /></td>
                <td className="px-4 py-2 max-w-[28ch] truncate text-xs" title={r.run?.objective}>{r.run?.objective ?? "—"}</td>
                <td className="px-4 py-2"><StatusBadge s={r.status} /></td>
                <td className="px-4 py-2">
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => setOpenId(r.id)}>
                      <FileDiff className="mr-1 h-3 w-3" /> Inspect
                    </Button>
                    {r.status === "pending" && (
                      <>
                        <Button size="sm" disabled={!canApprove || approve.isPending}
                          onClick={() => approve.mutate(r.id)}>
                          <ShieldCheck className="mr-1 h-3 w-3" /> Approve
                        </Button>
                        <Button size="sm" variant="destructive" disabled={!canApprove}
                          onClick={() => { setRejectingId(r.id); setReason(""); }}>
                          Reject
                        </Button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-sm text-muted-foreground">
                No proposed actions awaiting review.
              </td></tr>
            )}
          </tbody>
        </table>
      </CardContent>

      {/* Inspect sheet — diff + audit timeline */}
      <Sheet open={!!openId} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          {openId && (() => {
            const r = rows.find((x) => x.id === openId);
            if (!r) return null;
            return (
              <>
                <SheetHeader>
                  <SheetTitle className="flex items-center gap-2">
                    <FileDiff className="h-4 w-4" /> Proposed action
                    <span className="font-mono text-xs text-muted-foreground">{r.tool}</span>
                    <CeilingBadge c={r.policy_ceiling} />
                  </SheetTitle>
                  <SheetDescription>{r.run?.objective ?? "—"}</SheetDescription>
                </SheetHeader>
                <div className="mt-4 space-y-4">
                  <div>
                    <div className="mb-1 text-xs font-medium text-muted-foreground">Diff / impact</div>
                    <div className="rounded border bg-card p-2">
                      <DiffPreview tenantId={tenantId} actionId={r.id} tool={r.tool} before={r.before_state} input={r.input} />
                    </div>
                  </div>
                  <AgentActionTimeline tenantId={tenantId} actionId={r.id} />
                </div>
              </>
            );
          })()}
        </SheetContent>
      </Sheet>

      {/* Single-action reject dialog */}
      <Dialog open={!!rejectingId} onOpenChange={(o) => !o && setRejectingId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject proposed action</DialogTitle>
          </DialogHeader>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Demo Bank Treasury policy — tolerance > 0.01 requires Cash Ops Manager approval" rows={4} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectingId(null)}>Cancel</Button>
            <Button variant="destructive" disabled={reason.trim().length < 3 || reject.isPending}
              onClick={() => rejectingId && reject.mutate({ action_id: rejectingId, reason: reason.trim() })}>
              Reject action
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk approve / reject dialog with per-action notes + single confirmation */}
      <Dialog open={!!bulkMode} onOpenChange={(o) => !o && setBulkMode(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {bulkMode === "approve" ? `Bulk approve ${selectedRows.length} actions` : `Bulk reject ${selectedRows.length} actions`}
            </DialogTitle>
            <DialogDescription>
              {bulkMode === "approve"
                ? "Each action will be executed in order and a reversal token will be minted. Notes are optional and appended to the audit trail."
                : "Each rejection requires a reason of at least 3 characters; they are written to the audit trail."}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
            {selectedRows.map((r) => (
              <div key={r.id} className="rounded border p-2">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-mono">{r.tool}</span>
                  <CeilingBadge c={r.policy_ceiling} />
                  <span className="text-muted-foreground">· {r.run?.objective ?? "—"}</span>
                </div>
                <Textarea
                  className="mt-1"
                  rows={2}
                  placeholder={bulkMode === "approve" ? "Optional note (audit trail)" : "Required reason (≥ 3 chars)"}
                  value={bulkNotes[r.id] ?? ""}
                  onChange={(e) => setBulkNotes((p) => ({ ...p, [r.id]: e.target.value }))}
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkMode(null)}>Cancel</Button>
            {bulkMode === "approve" ? (
              <Button
                disabled={!bulkValid || bulkApprove.isPending}
                onClick={() => bulkApprove.mutate(
                  selectedRows.map((r) => ({ action_id: r.id, note: bulkNotes[r.id]?.trim() || undefined })),
                )}
              >
                <ShieldCheck className="mr-1 h-3 w-3" /> Confirm approve ({selectedRows.length})
              </Button>
            ) : (
              <Button
                variant="destructive"
                disabled={!bulkValid || bulkReject.isPending}
                onClick={() => bulkReject.mutate(
                  selectedRows.map((r) => ({ action_id: r.id, note: (bulkNotes[r.id] ?? "").trim() })),
                )}
              >
                Confirm reject ({selectedRows.length})
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
