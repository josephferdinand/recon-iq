import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Clock3, Inbox, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { listSignupRequests, decideSignupRequest } from "@/lib/signup-admission.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Decision = "approved" | "denied";
type SignupRequest = {
  id: string;
  tenant_id: string;
  user_id: string;
  email: string;
  full_name: string | null;
  status: "pending" | Decision;
  requested_at: string;
  decided_at: string | null;
};

function timeLabel(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

export function SignupAdmissionsTab({ tenantId }: { tenantId: string }) {
  const queryClient = useQueryClient();
  const list = useServerFn(listSignupRequests);
  const decide = useServerFn(decideSignupRequest);
  const [selected, setSelected] = useState<{ request: SignupRequest; decision: Decision } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const queryKey = ["signup-requests", tenantId];
  const requests = useQuery({
    queryKey,
    queryFn: () => list({ data: { tenant_id: tenantId } }),
  });
  const decision = useMutation({
    mutationFn: ({ request, decision }: { request: SignupRequest; decision: Decision }) =>
      decide({ data: { tenant_id: tenantId, request_id: request.id, decision } }),
    onSuccess: (_result, input) => {
      toast.success(input.decision === "approved" ? "Access approved" : "Request denied");
      setSelected(null);
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: () => toast.error("Could not review this request. Please refresh and try again."),
  });

  const rows = (requests.data ?? []) as SignupRequest[];
  const pending = rows.filter((row) => row.status === "pending");
  const history = rows.filter((row) => row.status !== "pending");
  const visible = showHistory ? history : pending;

  return (
    <div className="mt-4 space-y-4">
      <div className="rounded-xl border border-primary/20 bg-primary/5 px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2 text-primary"><ShieldCheck className="h-5 w-5" aria-hidden /></div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold">Signup admissions</h2>
            <p className="text-sm text-muted-foreground">Review verified email holders from this tenant’s approved domain. Domain matching does not grant access until you approve each person.</p>
          </div>
          <Badge variant="outline" className="gap-1.5"><Clock3 className="h-3.5 w-3.5" aria-hidden />{requests.isSuccess ? `${pending.length} awaiting review` : requests.isError ? "Queue unavailable" : "Checking queue"}</Badge>
        </div>
      </div>

      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Admission queue</CardTitle>
            <CardDescription>Confirm the person belongs to your organization before approving access.</CardDescription>
          </div>
          {requests.isSuccess ? (
            <div className="flex gap-2" role="group" aria-label="Request status">
              <Button size="sm" variant={showHistory ? "outline" : "default"} onClick={() => setShowHistory(false)}>Pending ({pending.length})</Button>
              <Button size="sm" variant={showHistory ? "default" : "outline"} onClick={() => setShowHistory(true)}>Reviewed ({history.length})</Button>
            </div>
          ) : null}
        </CardHeader>
        <CardContent>
          {requests.isPending ? (
            <p className="py-10 text-center text-sm text-muted-foreground" role="status">Loading requests…</p>
          ) : requests.isError ? (
            <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-5 text-sm">
              <p className="font-medium">Requests are temporarily unavailable</p>
              <p className="mt-1 text-muted-foreground">No admission decision can be made right now. Try again shortly.</p>
              <Button className="mt-3" variant="outline" size="sm" onClick={() => void requests.refetch()}>Try again</Button>
            </div>
          ) : visible.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground">
              <Inbox className="mx-auto mb-3 h-8 w-8 opacity-50" aria-hidden />
              <p className="font-medium text-foreground">{showHistory ? "No reviewed requests yet" : "All caught up"}</p>
              <p className="mt-1 text-sm">{showHistory ? "Admission decisions will appear here." : "New signup requests will appear here after email and domain checks."}</p>
            </div>
          ) : (
            <div className="divide-y rounded-lg border">
              {visible.map((row) => (
                <div key={row.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{row.full_name?.trim() || "Name not provided"}</p>
                      <Badge variant={row.status === "approved" ? "default" : "outline"}>{row.status === "pending" ? "Awaiting review" : row.status === "approved" ? "Approved" : "Denied"}</Badge>
                    </div>
                    <p className="break-all text-sm text-muted-foreground">{row.email}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Requested {timeLabel(row.requested_at)}{row.decided_at ? ` · Reviewed ${timeLabel(row.decided_at)}` : ""}</p>
                  </div>
                  {row.status === "pending" && (
                    <div className="flex shrink-0 gap-2">
                      <Button size="sm" variant="outline" onClick={() => setSelected({ request: row, decision: "denied" })}><X className="mr-1 h-4 w-4" aria-hidden />Deny</Button>
                      <Button size="sm" onClick={() => setSelected({ request: row, decision: "approved" })}><Check className="mr-1 h-4 w-4" aria-hidden />Approve</Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={selected !== null} onOpenChange={(open) => { if (!open && !decision.isPending) setSelected(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selected?.decision === "approved" ? "Approve tenant access?" : "Deny signup request?"}</DialogTitle>
            <DialogDescription>
              {selected?.decision === "approved"
                ? `Confirm you have verified ${selected.request.email} belongs to this organization. Approval grants this account tenant viewer access.`
                : `Deny the request from ${selected?.request.email}. The account will not receive tenant access.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={decision.isPending} onClick={() => setSelected(null)}>Cancel</Button>
            <Button
              variant={selected?.decision === "denied" ? "destructive" : "default"}
              disabled={!selected || decision.isPending}
              onClick={() => { if (selected) decision.mutate(selected); }}
            >{decision.isPending ? "Saving…" : selected?.decision === "approved" ? "Approve access" : "Deny request"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
