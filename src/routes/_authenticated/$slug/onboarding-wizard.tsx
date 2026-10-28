import { useEffect, useState } from "react";
import { createFileRoute, getRouteApi, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  completeOnboardingWizard,
  getOnboardingProgress,
  launchFirstTestRun,
  upsertOnboardingStep,
} from "@/lib/onboarding-wizard.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, Circle, Database, GitBranch, Play, ShieldCheck, UserPlus, ArrowRight, ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { formatReconRunId } from "@/lib/recon-run-id";

const parentRoute = getRouteApi("/_authenticated/$slug");

export const Route = createFileRoute("/_authenticated/$slug/onboarding-wizard")({
  component: OnboardingWizardPage,
});

const STEPS = [
  { n: 1, key: "tenant", label: "Tenant basics", icon: ShieldCheck },
  { n: 2, key: "source", label: "First data source", icon: Database },
  { n: 3, key: "rule", label: "First rule", icon: GitBranch },
  { n: 4, key: "team", label: "Invite team", icon: UserPlus },
  { n: 5, key: "sso", label: "SSO (optional)", icon: ShieldCheck },
  { n: 6, key: "run", label: "First test run", icon: Play },
] as const;

function OnboardingWizardPage() {
  const { tenant } = parentRoute.useLoaderData() as { tenant: { id: string; slug: string; name: string } };
  const navigate = useNavigate();
  const qc = useQueryClient();

  const getProgressFn = useServerFn(getOnboardingProgress);
  const upsertFn = useServerFn(upsertOnboardingStep);
  const completeFn = useServerFn(completeOnboardingWizard);
  const firstRunFn = useServerFn(launchFirstTestRun);

  const progressQ = useQuery({
    queryKey: ["onboarding-wizard", tenant.id],
    queryFn: () => getProgressFn({ data: { tenant_id: tenant.id } }),
  });

  const [step, setStep] = useState(1);
  const [step1, setStep1] = useState({ name: tenant.name, region: "us-east-1", default_currency: "USD" });
  const [step2, setStep2] = useState({ type: "file", label: "Initial upload" });
  const [step3, setStep3] = useState({ template_id: "nostro-v1" });
  const [step4, setStep4] = useState({ invites: "" });
  const [step5, setStep5] = useState({ provider: "okta", metadata_url: "" });
  const [step6, setStep6] = useState<{ run_id?: string; run_uid?: string | null; status?: string } | null>(null);

  // Resume from server state if present
  useEffect(() => {
    const p = progressQ.data;
    if (!p) return;
    if (p.step1_tenant) setStep1((s) => ({ ...s, ...(p.step1_tenant as typeof s) }));
    if (p.step2_data_source) setStep2((s) => ({ ...s, ...(p.step2_data_source as typeof s) }));
    if (p.step3_rule) setStep3((s) => ({ ...s, ...(p.step3_rule as typeof s) }));
    if (p.step4_team) setStep4((s) => ({ ...s, ...(p.step4_team as typeof s) }));
    if (p.step5_sso) setStep5((s) => ({ ...s, ...(p.step5_sso as typeof s) }));
    if (p.step6_first_run) setStep6(p.step6_first_run as { run_id?: string; run_uid?: string | null; status?: string });
    setStep(p.current_step);
  }, [progressQ.data]);

  const upsertMut = useMutation({
    mutationFn: (args: { step: number; payload: unknown }) =>
      upsertFn({ data: { tenant_id: tenant.id, step: args.step, payload: args.payload } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["onboarding-wizard"] }),
    onError: (e: any) => toast.error(e?.message ?? "Could not save step"),
  });

  const completeMut = useMutation({
    mutationFn: () => completeFn({ data: { tenant_id: tenant.id } }),
    onSuccess: () => {
      toast.success("Onboarding complete. Welcome to ReconIQ.");
      navigate({ to: "/$slug/workspace", params: { slug: tenant.slug } });
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not complete onboarding"),
  });

  const firstRunMut = useMutation({
    mutationFn: () => firstRunFn({ data: { tenant_id: tenant.id } }),
    onSuccess: (run: { id: string; run_uid: string | null; status: string }) => {
      toast.success("First test run queued");
      setStep6({ run_id: run.id, run_uid: run.run_uid, status: run.status });
      qc.invalidateQueries({ queryKey: ["onboarding-wizard"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not launch first test run"),
  });

  function saveAndAdvance(currentStep: number, payload: unknown) {
    upsertMut.mutate(
      { step: currentStep, payload },
      {
        onSuccess: () => setStep((s) => Math.min(6, s + 1)),
      },
    );
  }

  function goBack() {
    setStep((s) => Math.max(1, s - 1));
  }

  const completedSteps = Array.isArray(progressQ.data?.completed_steps)
    ? (progressQ.data!.completed_steps as number[])
    : [];
  const progressPct = Math.round(((completedSteps.length ?? step - 1) / 6) * 100);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome to {tenant.name}</h1>
        <p className="text-sm text-muted-foreground">
          Step {step} of 6 · progress auto-saved · you can resume at any time.
        </p>
        <Progress aria-label="Onboarding completion" className="mt-3" value={progressPct} />
      </div>

      <ol className="flex flex-wrap items-center gap-2 text-xs">
        {STEPS.map((s) => {
          const done = completedSteps.includes(s.n);
          const current = step === s.n;
          const Icon = done ? CheckCircle2 : current ? s.icon : Circle;
          return (
            <li key={s.n} className={`flex items-center gap-1 rounded-full border px-2 py-1 ${
              current ? "border-primary bg-primary/10 text-primary" :
              done ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" :
              "border-border text-muted-foreground"
            }`}>
              <Icon className="h-3 w-3" />
              <span>{s.n}. {s.label}</span>
            </li>
          );
        })}
      </ol>

      {step === 1 && (
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle className="text-base">Step 1 — Tenant basics</CardTitle>
            <CardDescription>Confirm your workspace identity and default currency.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Field label="Workspace name">
              <Input aria-label="Workspace name" value={step1.name} onChange={(e) => setStep1({ ...step1, name: e.target.value })} />
            </Field>
            <Field label="Region">
              <Input aria-label="Region" value={step1.region} onChange={(e) => setStep1({ ...step1, region: e.target.value })} />
            </Field>
            <Field label="Default currency">
              <Input aria-label="Default currency" value={step1.default_currency} onChange={(e) => setStep1({ ...step1, default_currency: e.target.value })} />
            </Field>
            <FooterRow
              onBack={null}
              onNext={() => saveAndAdvance(1, step1)}
              busy={upsertMut.isPending}
            />
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle className="text-base">Step 2 — Connect your first data source</CardTitle>
            <CardDescription>Pick a connector type. We'll guide you to the exact page next.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Field label="Connector type">
              <select
                aria-label="Connector type"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={step2.type}
                onChange={(e) => setStep2({ ...step2, type: e.target.value })}
              >
                <option value="file">File upload (CSV / JSON)</option>
                <option value="api">REST API</option>
                <option value="bank_feed">Bank feed (Plaid / SWIFT / EBICS)</option>
                <option value="database">Direct database</option>
              </select>
            </Field>
            <Field label="Friendly label">
              <Input aria-label="Data source friendly label" value={step2.label} onChange={(e) => setStep2({ ...step2, label: e.target.value })} />
            </Field>
            <FooterRow onBack={goBack} onNext={() => saveAndAdvance(2, step2)} busy={upsertMut.isPending} />
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle className="text-base">Step 3 — Pick a rule template</CardTitle>
            <CardDescription>You can refine this later in ReconIQ Studio.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Field label="Template">
              <select
                aria-label="Reconciliation rule template"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={step3.template_id}
                onChange={(e) => setStep3({ ...step3, template_id: e.target.value })}
              >
                <option value="nostro-v1">Nostro reconciliation (bank-to-bank)</option>
                <option value="custody-v1">Custody position vs ledger</option>
                <option value="card-scheme-v1">Card scheme clearing</option>
                <option value="crypto-onramp-v1">Crypto on-ramp vs fiat payout</option>
                <option value="custom">Custom rule (advanced)</option>
              </select>
            </Field>
            <FooterRow onBack={goBack} onNext={() => saveAndAdvance(3, step3)} busy={upsertMut.isPending} />
          </CardContent>
        </Card>
      )}

      {step === 4 && (
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle className="text-base">Step 4 — Invite your team</CardTitle>
            <CardDescription>Comma-separated emails. SCIM can replace this later.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Field label="Email list">
              <textarea
                aria-label="Team email list"
                className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="alice@bank.com, bob@bank.com"
                value={step4.invites}
                onChange={(e) => setStep4({ ...step4, invites: e.target.value })}
              />
            </Field>
            <FooterRow onBack={goBack} onNext={() => saveAndAdvance(4, { invites: step4.invites.split(",").map((s) => s.trim()).filter(Boolean) })} busy={upsertMut.isPending} />
          </CardContent>
        </Card>
      )}

      {step === 5 && (
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle className="text-base">Step 5 — Connect SSO (optional)</CardTitle>
            <CardDescription>You can skip this and configure it later from Admin → Auth providers.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Field label="Provider">
              <select
                aria-label="SSO provider"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={step5.provider}
                onChange={(e) => setStep5({ ...step5, provider: e.target.value })}
              >
                <option value="okta">Okta</option>
                <option value="entra">Microsoft Entra</option>
                <option value="google">Google Workspace</option>
              </select>
            </Field>
            <Field label="Metadata URL">
              <Input
                aria-label="SSO metadata URL"
                value={step5.metadata_url}
                placeholder="https://your-idp.example.com/app/sso/saml/metadata"
                onChange={(e) => setStep5({ ...step5, metadata_url: e.target.value })}
              />
            </Field>
            <FooterRow
              onBack={goBack}
              onNext={() => saveAndAdvance(5, step5)}
              busy={upsertMut.isPending}
              skipOption
              onSkip={() => { setStep(6); }}
            />
          </CardContent>
        </Card>
      )}

      {step === 6 && (
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle className="text-base">Step 6 — Launch your first test run</CardTitle>
            <CardDescription>
              We'll queue a recon_runs row using your first active reconciliation definition so you
              can see the matching engine live.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {step6?.run_id ? (
              <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">
                <div className="flex items-center gap-2 font-medium text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="h-4 w-4" />
                  Test run queued
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Run ID <code className="rounded bg-muted px-1">{formatReconRunId(step6.run_uid, step6.run_id)}</code> ·
                  Status <Badge variant="outline">{step6.status ?? "queued"}</Badge>
                </div>
              </div>
            ) : (
              <Button onClick={() => firstRunMut.mutate()} disabled={firstRunMut.isPending}>
                {firstRunMut.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1.5 h-3.5 w-3.5" />}
                Launch test run
              </Button>
            )}
            <FooterRow
              onBack={goBack}
              onNext={() => completeMut.mutate()}
              busy={completeMut.isPending}
              nextLabel="Finish onboarding"
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

function FooterRow({
  onBack,
  onNext,
  busy,
  skipOption,
  onSkip,
  nextLabel = "Continue",
}: {
  onBack: (() => void) | null;
  onNext: () => void;
  busy: boolean;
  skipOption?: boolean;
  onSkip?: () => void;
  nextLabel?: string;
}) {
  return (
    <div className="flex items-center justify-between pt-2">
      {onBack ? (
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back
        </Button>
      ) : <span />}
      <div className="flex items-center gap-2">
        {skipOption && onSkip ? (
          <Button variant="ghost" size="sm" onClick={onSkip}>Skip</Button>
        ) : null}
        <Button size="sm" onClick={onNext} disabled={busy}>
          {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="mr-1 h-3.5 w-3.5" />}
          {nextLabel}
        </Button>
      </div>
    </div>
  );
}
