import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ShieldCheck,
  ShieldAlert,
  Hash,
  Loader2,
  Link2,
  Link2Off,
} from "lucide-react";
import { toast } from "sonner";
import { verifyGithubSyncChain } from "@/lib/github-sync.functions";

type Props = {
  requestId: string;
  label?: string;
  size?: "sm" | "default";
  variant?: "outline" | "ghost" | "secondary";
};

type Result = Awaited<ReturnType<typeof verifyGithubSyncChain>>;

function HashChip({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[10px]">
      <Hash className="h-3 w-3 text-muted-foreground" />
      {value.slice(0, 16)}…{value.slice(-6)}
    </span>
  );
}

export function GithubSyncVerifyChainDialog({
  requestId,
  label = "Verify chain",
  size = "sm",
  variant = "outline",
}: Props) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const verifyFn = useServerFn(verifyGithubSyncChain);
  const verify = useMutation({
    mutationFn: () => verifyFn({ data: { request_id: requestId } }),
    onSuccess: (r) => {
      setResult(r);
      if (r.ok) toast.success("Evidence chain verified end-to-end");
      else toast.error("Evidence chain verification failed");
    },
    onError: (e: any) => toast.error(`Verification error: ${e.message}`),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o && !result) verify.mutate();
        if (!o) setResult(null);
      }}
    >
      <DialogTrigger asChild>
        <Button size={size} variant={variant}>
          <ShieldCheck className="mr-1 h-3 w-3" />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Evidence chain verification
            {result &&
              (result.ok ? (
                <Badge variant="default" className="gap-1">
                  <ShieldCheck className="h-3 w-3" /> Verified
                </Badge>
              ) : (
                <Badge variant="destructive" className="gap-1">
                  <ShieldAlert className="h-3 w-3" /> Failed
                </Badge>
              ))}
          </DialogTitle>
          <DialogDescription>
            Recomputes the change-request evidence hash and replays the
            append-only audit chain for this request.
          </DialogDescription>
        </DialogHeader>

        {verify.isPending && (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Verifying…
          </div>
        )}

        {result && (
          <div className="space-y-5">
            {/* Step 1 — evidence recompute */}
            <section className="rounded-md border bg-muted/30 p-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-semibold">
                  Step 1 · Evidence SHA-256 recompute
                </div>
                {result.request.evidence_ok ? (
                  <Badge variant="default" className="gap-1">
                    <ShieldCheck className="h-3 w-3" /> Match
                  </Badge>
                ) : (
                  <Badge variant="destructive" className="gap-1">
                    <ShieldAlert className="h-3 w-3" /> Mismatch
                  </Badge>
                )}
              </div>
              <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                <div>
                  <div className="uppercase tracking-wide text-muted-foreground">
                    Stored
                  </div>
                  <HashChip value={result.request.stored_evidence_sha256} />
                </div>
                <div>
                  <div className="uppercase tracking-wide text-muted-foreground">
                    Recomputed
                  </div>
                  <HashChip value={result.request.recomputed_evidence_sha256} />
                </div>
              </div>
            </section>

            {/* Step 2 — audit timeline */}
            <section className="rounded-md border p-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-semibold">
                  Step 2 · Audit timeline ({result.audit_chain.entries.length}{" "}
                  entries)
                </div>
                {result.audit_chain.all_evidence_links_ok ? (
                  <Badge variant="default" className="gap-1">
                    <Link2 className="h-3 w-3" /> Links match
                  </Badge>
                ) : (
                  <Badge variant="destructive" className="gap-1">
                    <Link2Off className="h-3 w-3" /> Broken link
                  </Badge>
                )}
              </div>
              {result.audit_chain.entries.length === 0 ? (
                <div className="py-2 text-xs text-muted-foreground">
                  No audit entries are linked to this request yet.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Actor</TableHead>
                      <TableHead>prev_hash</TableHead>
                      <TableHead>row_hash</TableHead>
                      <TableHead>Evidence link</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.audit_chain.entries.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(e.occurred_at).toLocaleString()}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {e.action}
                        </TableCell>
                        <TableCell className="text-xs">
                          {e.actor_email ?? e.actor_user_id?.slice(0, 8) ?? "—"}
                        </TableCell>
                        <TableCell>
                          <HashChip value={e.prev_hash} />
                        </TableCell>
                        <TableCell>
                          <HashChip value={e.row_hash} />
                        </TableCell>
                        <TableCell>
                          {e.context_evidence_sha256 ? (
                            e.evidence_link_ok ? (
                              <Badge variant="secondary" className="gap-1">
                                <Link2 className="h-3 w-3" /> ok
                              </Badge>
                            ) : (
                              <Badge variant="destructive" className="gap-1">
                                <Link2Off className="h-3 w-3" /> broken
                              </Badge>
                            )
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              n/a
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </section>

            {/* Step 3 — global chain verify */}
            <section className="rounded-md border p-3">
              <div className="mb-1 flex items-center justify-between">
                <div className="text-sm font-semibold">
                  Step 3 · Global audit chain integrity
                </div>
                {result.audit_chain.ok ? (
                  <Badge variant="default" className="gap-1">
                    <ShieldCheck className="h-3 w-3" />
                    {result.audit_chain.fork_count > 0
                      ? `Intact · ${result.audit_chain.fork_count} historical fork`
                      : "Intact"}
                  </Badge>
                ) : (
                  <Badge variant="destructive" className="gap-1">
                    <ShieldAlert className="h-3 w-3" /> Tampered
                  </Badge>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                {result.audit_chain.ok
                  ? result.audit_chain.fork_count > 0
                    ? `Every audit row hash and parent reference is valid. ${result.audit_chain.fork_count} preserved historical concurrency fork is reported; the serialized chain head matches the latest row.`
                    : "Every audit_log row hashes correctly, every parent resolves, and the serialized chain head matches the latest row."
                  : `Audit-chain verification reported the first inconsistency at audit_log.id = ${result.audit_chain.first_bad_id}.`}
              </div>
            </section>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            disabled={verify.isPending}
            onClick={() => verify.mutate()}
          >
            {verify.isPending ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <ShieldCheck className="mr-1 h-3 w-3" />
            )}
            Re-verify
          </Button>
          <Button onClick={() => setOpen(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
