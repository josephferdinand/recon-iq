/**
 * SchemaTenantWizardPanel — 3-step wizard to file a schema-per-tenant request
 * plus a history table of past requests. Sales-led workflow for regulated
 * clients that require a dedicated Postgres schema.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { CheckCircle2, ChevronLeft, ChevronRight, FileCheck2 } from "lucide-react";
import { toast } from "sonner";
import {
  listSchemaPerTenantRequests,
  createSchemaPerTenantRequest,
} from "@/lib/phase8-silo.functions";

type Request = {
  id: string;
  regulator_ref?: string | null;
  justification?: string | null;
  status: string;
  decided_at?: string | null;
  notes?: string | null;
  created_at?: string | null;
};

const STATUS_TONE: Record<string, string> = {
  open: "border-amber-500/40 text-amber-600",
  reviewing: "border-sky-500/40 text-sky-600",
  approved: "border-emerald-500/40 text-emerald-600",
  provisioned: "border-emerald-500/40 text-emerald-600",
  live: "border-emerald-500/40 text-emerald-600",
  rejected: "border-rose-500/40 text-rose-600",
};

export function SchemaTenantWizardPanel({ tenantId, canRequest = true }: { tenantId: string; canRequest?: boolean }) {
  const ls = useServerFn(listSchemaPerTenantRequests);
  const create = useServerFn(createSchemaPerTenantRequest);
  const qc = useQueryClient();
  const listQ = useQuery({
    queryKey: ["p8-sptr", tenantId],
    queryFn: () => ls({ data: { tenant_id: tenantId, openOnly: false } }),
  });

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [regulator, setRegulator] = useState("");
  const [businessCtx, setBusinessCtx] = useState("");
  const [justification, setJustification] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showWizard, setShowWizard] = useState(false);

  async function submit() {
    setSubmitting(true);
    try {
      const combined = [
        businessCtx && `Business context:\n${businessCtx}`,
        justification && `Regulatory justification:\n${justification}`,
      ].filter(Boolean).join("\n\n");
      await create({
        data: {
          tenant_id: tenantId,
          regulator_ref: regulator || undefined,
          justification: combined,
        },
      });
      toast.success("Schema-per-tenant request submitted");
      setShowWizard(false);
      setStep(1);
      setRegulator(""); setBusinessCtx(""); setJustification("");
      qc.invalidateQueries({ queryKey: ["p8-sptr", tenantId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to submit request");
    } finally {
      setSubmitting(false);
    }
  }

  const requests = (listQ.data ?? []) as Request[];
  const openCount = requests.filter((r) => !["provisioned", "live", "rejected"].includes(r.status)).length;

  return (
    <div className="space-y-4 pt-4">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FileCheck2 className="h-4 w-4" />
                Schema-per-tenant requests
                <Badge variant="outline">{requests.length} total</Badge>
                {openCount > 0 && <Badge variant="outline" className="border-amber-500/40 text-amber-600">{openCount} open</Badge>}
              </CardTitle>
              <CardDescription>
                Dedicated Postgres schema for regulated clients that need physical separation beyond RLS.
              </CardDescription>
            </div>
            {!showWizard && (
              <Button size="sm" onClick={() => setShowWizard(true)} disabled={!canRequest} title={!canRequest ? "Requires tenant_admin" : ""}>New request</Button>
            )}
          </div>
        </CardHeader>

        {showWizard && (
          <CardContent className="space-y-4 border-t pt-4">
            <WizardStepper step={step} />

            {step === 1 && (
              <div className="space-y-3">
                <div>
                  <Label htmlFor="regulator">Regulator / framework reference (optional)</Label>
                  <Input
                    id="regulator"
                    placeholder="e.g. FCA CASS 6.6.34R, MAS TRM, BaFin MaRisk AT 9"
                    value={regulator}
                    onChange={(e) => setRegulator(e.target.value)}
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">Rule, guideline, or supervisory instruction that mandates dedicated schema isolation.</p>
                </div>
                <div>
                  <Label htmlFor="ctx">Business context</Label>
                  <Textarea
                    id="ctx"
                    rows={4}
                    placeholder="Which business unit, product, or client relationship drives this? What data sits on the platform today?"
                    value={businessCtx}
                    onChange={(e) => setBusinessCtx(e.target.value)}
                  />
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-3">
                <Label htmlFor="just">Regulatory / risk justification</Label>
                <Textarea
                  id="just"
                  rows={8}
                  placeholder={
                    "Explain why RLS-based logical isolation is insufficient:\n• data-residency clause requiring physical isolation\n• supervisor demand for dedicated schema evidence\n• contractual undertaking to end client\n• incident lessons learned\n\nInclude any linked audit findings or supervisor letters."
                  }
                  value={justification}
                  onChange={(e) => setJustification(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">Minimum 10 characters. This text is preserved verbatim in the audit trail.</p>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-3">
                <p className="text-sm font-medium">Review & submit</p>
                <div className="rounded-md border bg-muted/20 p-3 text-xs space-y-2">
                  <div><span className="text-muted-foreground">Regulator ref:</span> {regulator || <em className="text-muted-foreground">none provided</em>}</div>
                  <div><span className="text-muted-foreground">Business context:</span><pre className="whitespace-pre-wrap font-sans mt-1">{businessCtx || "—"}</pre></div>
                  <div><span className="text-muted-foreground">Justification:</span><pre className="whitespace-pre-wrap font-sans mt-1">{justification || "—"}</pre></div>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Submitting notifies Platform Ops & Compliance. Provisioning is a 10–15 business day process (contract → cluster → migration → cutover).
                </p>
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => { setShowWizard(false); setStep(1); }}
                >
                  Cancel
                </Button>
                {step > 1 && (
                  <Button size="sm" variant="outline" onClick={() => setStep((step - 1) as 1 | 2 | 3)}>
                    <ChevronLeft className="h-4 w-4 mr-1" /> Back
                  </Button>
                )}
              </div>
              {step < 3 ? (
                <Button
                  size="sm"
                  onClick={() => setStep((step + 1) as 1 | 2 | 3)}
                  disabled={step === 2 && justification.trim().length < 10}
                >
                  Next <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              ) : (
                <Button size="sm" onClick={submit} disabled={submitting || justification.trim().length < 10}>
                  {submitting ? "Submitting…" : (<><CheckCircle2 className="h-4 w-4 mr-1" /> Submit request</>)}
                </Button>
              )}
            </div>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Request history</CardTitle></CardHeader>
        <CardContent>
          {listQ.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : requests.length === 0 ? (
            <p className="text-sm text-muted-foreground">No schema-per-tenant requests on file.</p>
          ) : (
            <div className="space-y-2">
              {requests.map((r) => (
                <div key={r.id} className="rounded border p-3 text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-mono">{r.regulator_ref ?? "—"}</span>
                    <Badge variant="outline" className={STATUS_TONE[r.status] ?? ""}>{r.status}</Badge>
                  </div>
                  {r.justification && (
                    <p className="text-muted-foreground line-clamp-2 whitespace-pre-wrap">{r.justification}</p>
                  )}
                  <p className="text-[10px] text-muted-foreground">
                    {r.created_at ? `Filed ${new Date(r.created_at).toLocaleDateString()}` : ""}
                    {r.decided_at ? ` · decided ${new Date(r.decided_at).toLocaleDateString()}` : ""}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function WizardStepper({ step }: { step: 1 | 2 | 3 }) {
  const labels = ["Context", "Justification", "Review"];
  return (
    <div className="flex items-center gap-2">
      {labels.map((l, i) => {
        const n = (i + 1) as 1 | 2 | 3;
        const done = step > n;
        const active = step === n;
        return (
          <div key={l} className="flex items-center gap-2">
            <div
              className={
                "h-6 w-6 rounded-full text-[11px] font-semibold flex items-center justify-center border " +
                (done
                  ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-600"
                  : active
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted text-muted-foreground border-border")
              }
            >
              {done ? "✓" : n}
            </div>
            <span className={"text-xs " + (active ? "font-medium" : "text-muted-foreground")}>{l}</span>
            {i < labels.length - 1 && <span className="text-muted-foreground">·</span>}
          </div>
        );
      })}
    </div>
  );
}
