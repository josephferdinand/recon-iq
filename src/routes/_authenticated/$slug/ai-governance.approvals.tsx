import { createFileRoute, useParams, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getTenantBySlug } from "@/lib/tenants.functions";
import { getApprovalSettings, updateApprovalSettings } from "@/lib/ai-governance-routing.functions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/_authenticated/$slug/ai-governance/approvals")({
  component: ApprovalsPage,
  errorComponent: ({ error }) => (<div className="p-6 text-sm text-destructive">Failed: {error instanceof Error ? error.message : "An unexpected error occurred."}</div>),
  notFoundComponent: () => <div className="p-6">Not found.</div>,
});

function ApprovalsPage() {
  const { slug } = useParams({ from: "/_authenticated/$slug/ai-governance/approvals" });
  const qc = useQueryClient();
  const getTenant = useServerFn(getTenantBySlug);
  const tenantQ = useQuery({ queryKey: ["tenant", slug], queryFn: () => getTenant({ data: { slug } }) });
  const tenantId = tenantQ.data?.id;

  const get = useServerFn(getApprovalSettings);
  const upd = useServerFn(updateApprovalSettings);
  const settingsQ = useQuery({
    queryKey: ["approval-settings", tenantId],
    queryFn: () => get({ data: { tenant_id: tenantId! } }),
    enabled: !!tenantId,
  });

  const [local, setLocal] = useState<any>(null);
  useEffect(() => { if (settingsQ.data) setLocal(settingsQ.data); }, [settingsQ.data]);

  const save = useMutation({
    mutationFn: (v: any) => upd({ data: v }),
    onSuccess: () => {
      toast.success("Approval settings saved");
      qc.invalidateQueries({ queryKey: ["approval-settings", tenantId] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Save failed"),
  });

  if (!tenantId || !local) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  const Toggle = ({ field, label, hint }: { field: string; label: string; hint: string }) => (
    <div className="flex items-start justify-between gap-4 rounded-md border border-border/60 p-3">
      <div>
        <Label className="text-sm font-medium">{label}</Label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch checked={!!local[field]} onCheckedChange={(v) => setLocal({ ...local, [field]: v })} />
    </div>
  );

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link to="/$slug/ai-governance" params={{ slug }}><ArrowLeft className="h-4 w-4" /> Back</Link>
        </Button>
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <ShieldCheck className="h-6 w-6" /> Approval Workflows
          </h1>
          <p className="text-sm text-muted-foreground">Toggle governance gates for every AI configuration change.</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Workflow toggles</CardTitle>
          <CardDescription>
            Disabled → authorized administrator executes immediately. Enabled → second approver required.
            Every action is audit-logged regardless of toggle state.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Toggle field="dual_approval_enabled" label="Dual approval" hint="Admin A submits, Admin B approves before activation." />
          <Toggle field="four_eyes_enabled" label="Four-eyes principle" hint="Requires two different identities to approve, blocks self-approval." />
          <Toggle field="governance_review_enabled" label="Governance review" hint="AI Governance team must review prompt / model / policy changes." />
          <Toggle field="security_review_enabled" label="Security review" hint="Security team must review provider / key / connectivity changes." />
          <Toggle field="compliance_review_enabled" label="Compliance review" hint="Compliance team must review residency / retention / audit changes." />

          <div className="pt-2">
            <Button onClick={() => save.mutate(local)} disabled={save.isPending}>Save approval settings</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
