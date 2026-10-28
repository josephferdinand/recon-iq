import { createFileRoute, getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getOnboardingStatus, verifyTenantAccess, completeOnboarding } from "@/lib/onboarding.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Circle, ShieldCheck, Database, UserCheck, ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";

const parentRoute = getRouteApi("/_authenticated/$slug");

export const Route = createFileRoute("/_authenticated/$slug/onboarding")({
  component: OnboardingPage,
});

function OnboardingPage() {
  const { tenant } = parentRoute.useLoaderData() as any;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const statusFn = useServerFn(getOnboardingStatus);
  const verifyFn = useServerFn(verifyTenantAccess);
  const completeFn = useServerFn(completeOnboarding);

  const q = useQuery({
    queryKey: ["onboarding", tenant.id],
    queryFn: () => statusFn({ data: { tenant_id: tenant.id } }),
  });

  const verifyMut = useMutation({
    mutationFn: () => verifyFn({ data: { tenant_id: tenant.id } }),
    onSuccess: () => { toast.success("Tenant access verified."); qc.invalidateQueries({ queryKey: ["onboarding"] }); },
    onError: (e: any) => toast.error(e?.message ?? "Verification failed"),
  });

  const completeMut = useMutation({
    mutationFn: () => completeFn({ data: { tenant_id: tenant.id } }),
    onSuccess: () => { toast.success("Onboarding complete. Welcome to ReconIQ."); navigate({ to: "/$slug/workspace", params: { slug: tenant.slug } }); },
    onError: (e: any) => toast.error(e?.message ?? "Could not complete onboarding"),
  });

  if (q.isLoading) {
    return <div className="flex h-64 items-center justify-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading onboarding…</div>;
  }
  const d = q.data!;

  return (
    <div className="mx-auto max-w-3xl p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Welcome to {d.tenant.name}</h1>
        <p className="text-sm text-muted-foreground">
          Region <Badge variant="outline">{d.tenant.region}</Badge> · slug <code className="text-xs">/{d.tenant.slug}</code>
          {d.tenant.residency_locked ? <Badge className="ml-2" variant="outline">Residency locked</Badge> : null}
        </p>
        {d.completed_at ? (
          <Badge className="mt-2 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30">
            Onboarding completed {new Date(d.completed_at).toLocaleString()}
          </Badge>
        ) : null}
      </div>

      <Step
        n={1}
        icon={<UserCheck className="h-4 w-4" />}
        title="Workspace verified"
        description="Your invitation has been accepted and your role is provisioned under strict multi-tenant isolation."
        done={d.checklist.workspace}
        meta={d.member_role ? `Role: ${d.member_role}` : undefined}
        action={null}
      />

      <Step
        n={2}
        icon={<Database className="h-4 w-4" />}
        title="Connect a data source"
        description="Add at least one data source (file upload, SFTP, S3, REST, or DB) so reconciliations can ingest data."
        done={d.checklist.data_source}
        meta={d.data_source_count > 0 ? `${d.data_source_count} data source(s) configured` : "No data sources yet"}
        action={
          <Link to="/$slug/tenant" params={{ slug: d.tenant.slug }} search={{ page: "connectors" }}>
            <Button size="sm" variant={d.checklist.data_source ? "outline" : "default"}>
              {d.checklist.data_source ? "Manage connectors" : "Add data source"} <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </Link>
        }
      />

      <Step
        n={3}
        icon={<ShieldCheck className="h-4 w-4" />}
        title="Verify tenant access"
        description="Run a round-trip check that confirms RLS keeps your workspace isolated from every other tenant."
        done={d.checklist.access_verified}
        meta="Probe reads your tenant under your session, then asserts no foreign tenant rows are visible."
        action={
          <Button size="sm" onClick={() => verifyMut.mutate()} disabled={verifyMut.isPending}
            variant={d.checklist.access_verified ? "outline" : "default"}>
            {verifyMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : d.checklist.access_verified ? "Re-run probe" : "Run isolation probe"}
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Finish onboarding</CardTitle>
          <CardDescription>You can complete onboarding once every step above is green. We will write an audit-log entry and unlock the full workspace.</CardDescription>
        </CardHeader>
        <CardContent className="flex justify-end gap-2">
          <Link to="/$slug/workspace" params={{ slug: d.tenant.slug }}>
            <Button variant="ghost">Skip for now</Button>
          </Link>
          <Button onClick={() => completeMut.mutate()} disabled={!d.ready_for_completion || completeMut.isPending}>
            {completeMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Complete onboarding"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function Step(props: {
  n: number; title: string; description: string; done: boolean;
  meta?: string; action: React.ReactNode; icon: React.ReactNode;
}) {
  return (
    <Card className={props.done ? "border-emerald-500/30" : ""}>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5">
              {props.done ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <Circle className="h-5 w-5 text-muted-foreground" />}
            </div>
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <span className="text-xs text-muted-foreground">Step {props.n}</span>
                {props.icon}
                {props.title}
              </CardTitle>
              <CardDescription>{props.description}</CardDescription>
              {props.meta ? <p className="mt-1 text-xs text-muted-foreground">{props.meta}</p> : null}
            </div>
          </div>
          {props.action}
        </div>
      </CardHeader>
    </Card>
  );
}
