import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import {
  listBrandApprovals, reviewBrandApproval, publishBrandApproval,
  cancelBrandApproval, myBrandWorkflowRoles,
  type BrandApproval, type BrandApprovalStatus,
} from "@/lib/mkt-brand-approvals.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, XCircle, Clock, ShieldCheck, RotateCcw } from "lucide-react";

export const Route = createFileRoute("/mkt-admin/brand/approvals")({
  component: BrandApprovalsPage,
});

const STATUS_META: Record<BrandApprovalStatus, { label: string; tone: string; icon: typeof Clock }> = {
  pending_review:  { label: "Awaiting review",  tone: "bg-amber-500/10 text-amber-500 border-amber-500/30", icon: Clock },
  pending_publish: { label: "Awaiting publish", tone: "bg-blue-500/10 text-blue-500 border-blue-500/30",   icon: ShieldCheck },
  executed:        { label: "Executed",         tone: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30", icon: CheckCircle2 },
  rejected:        { label: "Rejected",         tone: "bg-destructive/10 text-destructive border-destructive/30", icon: XCircle },
  cancelled:       { label: "Cancelled",        tone: "bg-muted text-muted-foreground border-border",     icon: RotateCcw },
};

function BrandApprovalsPage() {
  const qc = useQueryClient();
  const listFn    = useServerFn(listBrandApprovals);
  const rolesFn   = useServerFn(myBrandWorkflowRoles);
  const reviewFn  = useServerFn(reviewBrandApproval);
  const publishFn = useServerFn(publishBrandApproval);
  const cancelFn  = useServerFn(cancelBrandApproval);

  const [filter, setFilter] = useState<BrandApprovalStatus | "all">("all");

  const listQ = useQuery({
    queryKey: ["mkt","brand","approvals", filter],
    queryFn: () => listFn({ data: filter === "all" ? {} : { status: filter } }),
  });
  const rolesQ = useQuery({ queryKey: ["mkt","brand","approvals","me"], queryFn: () => rolesFn({ data: undefined }) });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["mkt","brand","approvals"] });

  const doReview = useMutation({
    mutationFn: (v: { id: string; decision: "approved" | "rejected"; note?: string }) => reviewFn({ data: v }),
    onSuccess: (r) => { toast.success(`Review ${r.review_decision === "approved" ? "approved" : "rejected"}`); invalidate(); },
    onError: (e) => toast.error((e as Error).message),
  });
  const doPublish = useMutation({
    mutationFn: (v: { id: string; decision: "approved" | "rejected"; note?: string }) => publishFn({ data: v }),
    onSuccess: (r) => { toast.success(r.status === "executed" ? "Published" : "Publish rejected"); invalidate(); },
    onError: (e) => toast.error((e as Error).message),
  });
  const doCancel = useMutation({
    mutationFn: (v: { id: string; note?: string }) => cancelFn({ data: v }),
    onSuccess: () => { toast.success("Request cancelled"); invalidate(); },
    onError: (e) => toast.error((e as Error).message),
  });

  const rows = (listQ.data ?? []) as BrandApproval[];
  const canReview  = !!rolesQ.data?.canReview;
  const canPublish = !!rolesQ.data?.canPublish;

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Approval workflow</h2>
            <p className="text-xs text-muted-foreground">
              Draft → Reviewer approval → Publisher approval. Separation of duties is enforced.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">You can act as:</span>
            <Badge variant={canReview ? "default" : "outline"}>Reviewer</Badge>
            <Badge variant={canPublish ? "default" : "outline"}>Publisher</Badge>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap gap-1">
          {(["all","pending_review","pending_publish","executed","rejected","cancelled"] as const).map((s) => (
            <button key={s} onClick={() => setFilter(s)}
              className={`rounded-md border px-2.5 py-1 text-xs transition ${
                filter === s ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground"
              }`}>
              {s === "all" ? "All" : STATUS_META[s].label}
            </button>
          ))}
        </div>

        {listQ.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> :
          rows.length === 0 ? <p className="text-sm text-muted-foreground">No requests match.</p> : (
            <ul className="space-y-3">
              {rows.map((r) => (
                <ApprovalRow key={r.id} row={r}
                  canReview={canReview} canPublish={canPublish}
                  onReview={(decision, note) => doReview.mutate({ id: r.id, decision, note })}
                  onPublish={(decision, note) => doPublish.mutate({ id: r.id, decision, note })}
                  onCancel={(note) => doCancel.mutate({ id: r.id, note })}
                  pending={doReview.isPending || doPublish.isPending || doCancel.isPending}
                />
              ))}
            </ul>
          )}
      </Card>
    </div>
  );
}

function ApprovalRow({
  row, canReview, canPublish, onReview, onPublish, onCancel, pending,
}: {
  row: BrandApproval;
  canReview: boolean;
  canPublish: boolean;
  onReview: (d: "approved"|"rejected", note?: string) => void;
  onPublish: (d: "approved"|"rejected", note?: string) => void;
  onCancel: (note?: string) => void;
  pending: boolean;
}) {
  const meta = STATUS_META[row.status];
  const Icon = meta.icon;
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);

  return (
    <li className="rounded-lg border border-border bg-background/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="uppercase">{row.subject_type}</Badge>
            <Badge variant="outline" className="uppercase">{row.action}</Badge>
            <Badge className={`inline-flex items-center gap-1 border ${meta.tone}`}>
              <Icon className="h-3 w-3" /> {meta.label}
            </Badge>
          </div>
          <div className="mt-1 text-sm font-medium text-foreground">
            {row.title ?? `${row.action} ${row.subject_type}`}
          </div>
          <div className="text-xs text-muted-foreground">
            <span className="font-mono">{row.subject_id.slice(0,8)}…</span> · requested by{" "}
            <span className="text-foreground">{row.requested_by_email ?? row.requested_by.slice(0,8)}</span>
            {" · "}{new Date(row.requested_at).toLocaleString()}
          </div>
          {row.notes && <div className="mt-2 rounded bg-muted/40 p-2 text-xs">{row.notes}</div>}

          <div className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
            <div>
              <span className="font-medium text-foreground">Review:</span>{" "}
              {row.reviewed_at
                ? <>{row.review_decision} by {row.reviewed_by_email ?? row.reviewed_by?.slice(0,8)} · {new Date(row.reviewed_at).toLocaleString()}{row.review_note ? ` — ${row.review_note}` : ""}</>
                : "—"}
            </div>
            <div>
              <span className="font-medium text-foreground">Publish:</span>{" "}
              {row.published_at
                ? <>{row.publish_decision} by {row.published_by_email ?? row.published_by?.slice(0,8)} · {new Date(row.published_at).toLocaleString()}{row.publish_note ? ` — ${row.publish_note}` : ""}</>
                : "—"}
            </div>
          </div>
          {row.execution_error && (
            <div className="mt-2 rounded border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
              Execution error: {row.execution_error}
            </div>
          )}
        </div>

        <div className="flex flex-col items-end gap-1">
          <Button size="sm" variant="ghost" onClick={() => setOpen((x) => !x)}>
            {open ? "Hide" : "Act"}
          </Button>
        </div>
      </div>

      {open && (
        <div className="mt-3 space-y-2 rounded border border-dashed border-border p-3">
          <Textarea placeholder="Optional decision note…" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          <div className="flex flex-wrap gap-2">
            {row.status === "pending_review" && canReview && (
              <>
                <Button size="sm" onClick={() => onReview("approved", note || undefined)} disabled={pending}>Approve review</Button>
                <Button size="sm" variant="outline" onClick={() => onReview("rejected", note || undefined)} disabled={pending}>Reject review</Button>
              </>
            )}
            {row.status === "pending_publish" && canPublish && (
              <>
                <Button size="sm" onClick={() => onPublish("approved", note || undefined)} disabled={pending}>Approve &amp; publish</Button>
                <Button size="sm" variant="outline" onClick={() => onPublish("rejected", note || undefined)} disabled={pending}>Reject publish</Button>
              </>
            )}
            {(row.status === "pending_review" || row.status === "pending_publish") && (
              <Button size="sm" variant="ghost" onClick={() => onCancel(note || undefined)} disabled={pending}>Cancel (requester only)</Button>
            )}
            {row.status !== "pending_review" && row.status !== "pending_publish" && (
              <span className="text-xs text-muted-foreground">No actions available in status <b>{row.status}</b>.</span>
            )}
          </div>
          {(row.status === "pending_review" && !canReview) && (
            <p className="text-xs text-muted-foreground">You need the <code>brand_reviewer</code> role to act on this stage.</p>
          )}
          {(row.status === "pending_publish" && !canPublish) && (
            <p className="text-xs text-muted-foreground">You need the <code>brand_publisher</code> role to act on this stage.</p>
          )}
        </div>
      )}
    </li>
  );
}
