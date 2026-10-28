// Certification stepper — drives an eod_signoffs record through
// draft → prepared → reviewed → certified with a server-validated
// state machine. Step 2 of Period-Close v2.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, Lock, RotateCcw, ShieldAlert } from "lucide-react";
import {
  advanceSignoff,
  listAllowedSignoffTransitions,
  listSignoffTransitions,
} from "@/lib/signoff-advance.functions";

const STEPS = [
  { key: "draft", label: "Draft" },
  { key: "prepared", label: "Prepared" },
  { key: "reviewed", label: "Reviewed" },
  { key: "certified", label: "Certified" },
] as const;

type Signoff = {
  id: string;
  status: string;
  locked: boolean;
  period_label: string | null;
  period_date: string;
  certified_hash: string | null;
  reopened_count: number;
};

export function SignoffStepper({ signoff }: { signoff: Signoff }) {
  const qc = useQueryClient();
  const advanceFn = useServerFn(advanceSignoff);
  const allowedFn = useServerFn(listAllowedSignoffTransitions);
  const histFn = useServerFn(listSignoffTransitions);

  const allowed = useQuery({
    queryKey: ["signoff-allowed", signoff.id, signoff.status],
    queryFn: () => allowedFn({ data: { signoff_id: signoff.id } }),
  });
  const history = useQuery({
    queryKey: ["signoff-history", signoff.id],
    queryFn: () => histFn({ data: { signoff_id: signoff.id } }),
  });

  const [comment, setComment] = useState("");

  const advance = useMutation({
    mutationFn: (to_status: string) =>
      advanceFn({
        data: {
          signoff_id: signoff.id,
          to_status: to_status as
            | "prepared"
            | "reviewed"
            | "certified"
            | "rejected"
            | "reopened",
          comment: comment || null,
        },
      }),
    onSuccess: (r: { status: string }) => {
      toast.success(`Sign-off advanced to ${r.status}`);
      setComment("");
      qc.invalidateQueries({ queryKey: ["signoff-allowed", signoff.id] });
      qc.invalidateQueries({ queryKey: ["signoff-history", signoff.id] });
      qc.invalidateQueries({ queryKey: ["signoffs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const currentIdx = STEPS.findIndex((s) => s.key === signoff.status);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          {signoff.locked ? (
            <Lock className="h-4 w-4 text-emerald-600" />
          ) : (
            <ShieldAlert className="h-4 w-4 text-amber-600" />
          )}
          Certification — {signoff.period_label ?? signoff.period_date}
        </CardTitle>
        <CardDescription>
          Server-enforced state machine. Separation of duties is checked on
          every transition; the certifier must differ from the preparer and
          reviewer.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ol className="flex flex-wrap items-center gap-2">
          {STEPS.map((s, i) => {
            const reached = i <= currentIdx;
            const isCurrent = i === currentIdx;
            return (
              <li key={s.key} className="flex items-center gap-2">
                <div
                  className={
                    "flex h-7 min-w-7 items-center justify-center rounded-full border px-2 text-xs " +
                    (isCurrent
                      ? "border-primary bg-primary text-primary-foreground"
                      : reached
                        ? "border-emerald-600/40 bg-emerald-600/10 text-emerald-700"
                        : "border-muted bg-muted/40 text-muted-foreground")
                  }
                >
                  {reached && !isCurrent ? (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : (
                    i + 1
                  )}
                </div>
                <span
                  className={
                    "text-xs " +
                    (isCurrent ? "font-semibold" : "text-muted-foreground")
                  }
                >
                  {s.label}
                </span>
                {i < STEPS.length - 1 && (
                  <span className="text-muted-foreground">›</span>
                )}
              </li>
            );
          })}
          {signoff.status === "rejected" && (
            <Badge variant="destructive">Rejected</Badge>
          )}
          {(signoff.reopened_count ?? 0) > 0 && (
            <Badge variant="outline">
              Reopened ×{signoff.reopened_count}
            </Badge>
          )}
        </ol>

        {signoff.certified_hash && (
          <div className="rounded-md border bg-muted/40 p-2 text-[10px] font-mono">
            certified sha256: {signoff.certified_hash}
          </div>
        )}

        <div className="space-y-2">
          <Textarea
            rows={2}
            placeholder="Optional reviewer/approver comment…"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            {(allowed.data ?? []).length === 0 ? (
              <span className="text-xs text-muted-foreground">
                No transitions available for your role at this step.
              </span>
            ) : (
              (allowed.data ?? []).map((next: string) => (
                <Button
                  key={next}
                  size="sm"
                  variant={
                    next === "certified"
                      ? "default"
                      : next === "rejected"
                        ? "destructive"
                        : "outline"
                  }
                  disabled={advance.isPending}
                  onClick={() => advance.mutate(next)}
                >
                  {next === "reopened" && (
                    <RotateCcw className="mr-1 h-3 w-3" />
                  )}
                  {next === "certified"
                    ? "Certify"
                    : next.charAt(0).toUpperCase() + next.slice(1)}
                </Button>
              ))
            )}
          </div>
        </div>

        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Transition history
          </div>
          <div className="space-y-1">
            {(history.data ?? []).length === 0 && (
              <div className="rounded-md border bg-muted/30 p-2 text-[11px] text-muted-foreground">
                No transitions yet.
              </div>
            )}
            {(history.data ?? []).map((h: any) => (
              <div
                key={h.id}
                className="flex items-center justify-between rounded-md border bg-card px-2 py-1 text-[11px]"
              >
                <div>
                  <span className="font-medium">
                    {h.from_status ?? "—"} → {h.to_status}
                  </span>
                  {h.comment && (
                    <span className="ml-2 text-muted-foreground">
                      “{h.comment}”
                    </span>
                  )}
                </div>
                <span className="text-muted-foreground">
                  {new Date(h.created_at).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
