import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  GitPullRequest,
  Check,
  X,
  Play,
  ShieldCheck,
  AlertTriangle,
  Hash,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import {
  listGithubSyncChangeRequests,
  proposeGithubSyncChange,
  approveGithubSyncChange,
  rejectGithubSyncChange,
  applyGithubSyncChange,
  cancelGithubSyncChange,
} from "@/lib/github-sync.functions";
import { supabase } from "@/integrations/supabase/client";
import { GithubSyncVerifyChainDialog } from "@/components/github-sync-verify-chain-dialog";

type Status = "pending" | "approved" | "rejected" | "applied" | "failed" | "cancelled";

type ChangeRequest = {
  id: string;
  created_at: string;
  proposed_owner: string;
  proposed_repo_name: string;
  proposed_branch: string;
  proposed_docs_path: string;
  previous_owner: string | null;
  previous_repo_name: string | null;
  previous_branch: string | null;
  previous_docs_path: string | null;
  reason: string;
  requested_by: string;
  requested_by_email: string | null;
  approver_1: string | null;
  approver_1_email: string | null;
  approver_2: string | null;
  approver_2_email: string | null;
  status: Status;
  apply_attempts: number;
  last_error: string | null;
  rejection_reason: string | null;
  applied_at: string | null;
  evidence_sha256: string | null;
  post_apply_verified: boolean | null;
  post_apply_verified_at: string | null;
  post_apply_verification: {
    evidence_ok?: boolean;
    chain_ok?: boolean;
    all_evidence_links_ok?: boolean;
    first_bad_audit_id?: number | null;
    audit_entry_count?: number;
    recomputed_evidence_sha256?: string;
    error?: string;
  } | null;
};


const STATUS_VARIANT: Record<Status, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline",
  approved: "secondary",
  rejected: "destructive",
  applied: "default",
  failed: "destructive",
  cancelled: "outline",
};

export function GithubSyncConfigPanel({
  currentRepo,
  currentBranch,
  currentPath,
  source,
}: {
  currentRepo: string;
  currentBranch: string;
  currentPath: string;
  source?: "env" | "database";
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [me, setMe] = useState<string | null>(null);

  // Lightweight: grab current user id once to disable self-approve.
  useState(() => {
    supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null));
    return null;
  });

  const listFn = useServerFn(listGithubSyncChangeRequests);
  const proposeFn = useServerFn(proposeGithubSyncChange);
  const approveFn = useServerFn(approveGithubSyncChange);
  const rejectFn = useServerFn(rejectGithubSyncChange);
  const applyFn = useServerFn(applyGithubSyncChange);
  const cancelFn = useServerFn(cancelGithubSyncChange);

  const reqQ = useQuery({
    queryKey: ["github-sync-change-requests"],
    queryFn: () => listFn({ data: {} }) as Promise<{ requests: ChangeRequest[] }>,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["github-sync-change-requests"] });
    qc.invalidateQueries({ queryKey: ["docs-sync-config"] });
  };

  const propose = useMutation({
    mutationFn: (v: {
      owner: string;
      repo_name: string;
      branch: string;
      docs_path: string;
      reason: string;
    }) => proposeFn({ data: v }),
    onSuccess: (r: any) => {
      toast.success(`Change request submitted (evidence ${String(r.evidence_sha256).slice(0, 10)}…)`);
      setOpen(false);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const approve = useMutation({
    mutationFn: (id: string) => approveFn({ data: { request_id: id } }),
    onSuccess: () => { toast.success("Approval recorded"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const reject = useMutation({
    mutationFn: (v: { id: string; reason: string }) =>
      rejectFn({ data: { request_id: v.id, reason: v.reason } }),
    onSuccess: () => { toast.success("Request rejected"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const apply = useMutation({
    mutationFn: (id: string) => applyFn({ data: { request_id: id } }),
    onSuccess: (r: any) => { toast.success(`Applied → ${r.repo}@${r.branch}`); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => cancelFn({ data: { request_id: id } }),
    onSuccess: () => { toast.success("Request cancelled"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const requests = reqQ.data?.requests ?? [];
  const pending = requests.filter((r) => r.status === "pending" || r.status === "approved");
  const history = requests.filter((r) => !["pending", "approved"].includes(r.status));

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" /> Repository configuration
            </CardTitle>
            <CardDescription>
              Owner, repo, branch and docs path used by GitHub Sync. Changes
              require dual approval (4-eyes) from two distinct platform admins
              and are recorded with a SHA-256 evidence hash in the audit chain.
            </CardDescription>
          </div>
          <Badge variant={source === "database" ? "default" : "outline"} className="gap-1">
            {source === "database" ? "DB-managed" : "Env fallback"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <KV label="Repository" value={currentRepo || "—"} />
          <KV label="Branch" value={currentBranch || "—"} />
          <KV label="Docs path" value={currentPath || "—"} />
          <div className="flex items-end justify-end">
            <ProposeDialog
              open={open}
              setOpen={setOpen}
              defaults={{
                owner: currentRepo.split("/")[0] ?? "",
                repo_name: currentRepo.split("/")[1] ?? "",
                branch: currentBranch || "main",
                docs_path: currentPath || "docs",
              }}
              onSubmit={(v) => propose.mutate(v)}
              submitting={propose.isPending}
            />
          </div>
        </div>

        {pending.length > 0 && (
          <div className="space-y-2">
            <div className="text-sm font-medium">Open change requests</div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Proposed</TableHead>
                  <TableHead>Requested by</TableHead>
                  <TableHead>Approvals</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">
                      {r.proposed_owner}/{r.proposed_repo_name}@{r.proposed_branch}
                      <div className="text-muted-foreground">{r.proposed_docs_path}</div>
                    </TableCell>
                    <TableCell className="text-xs">{r.requested_by_email ?? r.requested_by.slice(0, 8)}</TableCell>
                    <TableCell className="text-xs">
                      <div>{r.approver_1_email ? `① ${r.approver_1_email}` : "① —"}</div>
                      <div>{r.approver_2_email ? `② ${r.approver_2_email}` : "② —"}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[r.status]}>{r.status}</Badge>
                      {r.last_error && (
                        <div className="mt-1 flex items-start gap-1 text-xs text-destructive">
                          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                          <span className="break-all">{r.last_error}</span>
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap justify-end gap-1">
                        <GithubSyncVerifyChainDialog requestId={r.id} variant="ghost" />
                        {r.status === "pending" && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={
                                approve.isPending ||
                                me === r.requested_by ||
                                me === r.approver_1
                              }
                              onClick={() => approve.mutate(r.id)}
                              title={
                                me === r.requested_by
                                  ? "You requested this — 4-eyes prevents self-approval"
                                  : me === r.approver_1
                                    ? "You already approved this request"
                                    : "Approve"
                              }
                            >
                              <Check className="mr-1 h-3 w-3" />
                              Approve
                            </Button>
                            <RejectButton onConfirm={(reason) => reject.mutate({ id: r.id, reason })} />
                            {me === r.requested_by && (
                              <Button size="sm" variant="ghost" onClick={() => cancel.mutate(r.id)}>
                                Cancel
                              </Button>
                            )}
                          </>
                        )}
                        {r.status === "approved" && (
                          <Button
                            size="sm"
                            disabled={apply.isPending}
                            onClick={() => apply.mutate(r.id)}
                          >
                            {apply.isPending ? (
                              <RefreshCw className="mr-1 h-3 w-3 animate-spin" />
                            ) : (
                              <Play className="mr-1 h-3 w-3" />
                            )}
                            Apply
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {history.length > 0 && (
          <details className="space-y-2">
            <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
              History ({history.length})
            </summary>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Change</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Auto-verify</TableHead>
                  <TableHead>Evidence SHA-256</TableHead>
                  <TableHead className="text-right">Verify</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(r.applied_at ?? r.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.proposed_owner}/{r.proposed_repo_name}@{r.proposed_branch}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[r.status]}>{r.status}</Badge>
                    </TableCell>
                    <TableCell>
                      <AutoVerifyBadge row={r} />
                    </TableCell>
                    <TableCell className="font-mono text-[10px]">
                      <div className="flex items-center gap-1">
                        <Hash className="h-3 w-3 text-muted-foreground" />
                        {r.evidence_sha256 ? `${r.evidence_sha256.slice(0, 16)}…` : "—"}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <GithubSyncVerifyChainDialog requestId={r.id} variant="ghost" label="Verify" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

          </details>
        )}
      </CardContent>
    </Card>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 break-all font-mono text-sm">{value}</div>
    </div>
  );
}

function ProposeDialog({
  open,
  setOpen,
  defaults,
  onSubmit,
  submitting,
}: {
  open: boolean;
  setOpen: (b: boolean) => void;
  defaults: { owner: string; repo_name: string; branch: string; docs_path: string };
  onSubmit: (v: { owner: string; repo_name: string; branch: string; docs_path: string; reason: string }) => void;
  submitting: boolean;
}) {
  const [owner, setOwner] = useState(defaults.owner);
  const [repo, setRepo] = useState(defaults.repo_name);
  const [branch, setBranch] = useState(defaults.branch);
  const [docsPath, setDocsPath] = useState(defaults.docs_path);
  const [reason, setReason] = useState("");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <GitPullRequest className="mr-1 h-3 w-3" /> Request change
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request repository change</DialogTitle>
          <DialogDescription>
            Submitting creates a 4-eyes change request. Two distinct platform
            admins must approve before the change can be applied. You cannot
            approve your own request.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="gh-owner">Owner / organization</Label>
              <Input id="gh-owner" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="acme-corp" />
            </div>
            <div>
              <Label htmlFor="gh-repo">Repository name</Label>
              <Input id="gh-repo" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="fvi" />
            </div>
            <div>
              <Label htmlFor="gh-branch">Branch</Label>
              <Input id="gh-branch" value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" />
            </div>
            <div>
              <Label htmlFor="gh-path">Docs path</Label>
              <Input id="gh-path" value={docsPath} onChange={(e) => setDocsPath(e.target.value)} placeholder="docs" />
            </div>
          </div>
          <div>
            <Label htmlFor="gh-reason">Justification</Label>
            <Textarea
              id="gh-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this change needed? (≥10 chars, included in evidence record)"
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            disabled={submitting || !owner || !repo || !branch || !docsPath || reason.trim().length < 10}
            onClick={() => onSubmit({ owner, repo_name: repo, branch, docs_path: docsPath, reason })}
          >
            Submit request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RejectButton({ onConfirm }: { onConfirm: (reason: string) => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <X className="mr-1 h-3 w-3" /> Reject
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reject change request</DialogTitle>
          <DialogDescription>This is final and the request becomes immutable.</DialogDescription>
        </DialogHeader>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for rejection (≥5 chars)" rows={3} />
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            variant="destructive"
            disabled={reason.trim().length < 5}
            onClick={() => { onConfirm(reason); setOpen(false); }}
          >
            Reject
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Compact badge that summarises the automatic post-apply audit-chain
 * verification result on each change-request row. Shows pass / fail / not-run
 * with a tooltip-style title detailing every check.
 */
function AutoVerifyBadge({ row }: { row: ChangeRequest }) {
  // Only applied changes run the automatic post-apply verifier.
  if (row.status !== "applied") {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  if (row.post_apply_verified === null || row.post_apply_verified === undefined) {
    return (
      <Badge variant="outline" className="gap-1">
        <RefreshCw className="h-3 w-3" /> Not run
      </Badge>
    );
  }
  const s = row.post_apply_verification ?? {};
  const at = row.post_apply_verified_at
    ? new Date(row.post_apply_verified_at).toLocaleString()
    : "";
  const detail = [
    `Verified at: ${at}`,
    `Evidence match: ${s.evidence_ok ? "ok" : "fail"}`,
    `Audit chain: ${s.chain_ok ? "ok" : "fail"}`,
    `Evidence links: ${s.all_evidence_links_ok ? "ok" : "fail"}`,
    typeof s.audit_entry_count === "number" ? `Audit entries: ${s.audit_entry_count}` : null,
    s.first_bad_audit_id != null ? `First bad audit id: ${s.first_bad_audit_id}` : null,
    s.error ? `Error: ${s.error}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  return row.post_apply_verified ? (
    <Badge variant="default" className="gap-1" title={detail}>
      <ShieldCheck className="h-3 w-3" /> Chain verified
    </Badge>
  ) : (
    <Badge variant="destructive" className="gap-1" title={detail}>
      <AlertTriangle className="h-3 w-3" /> Chain failed
    </Badge>
  );
}

