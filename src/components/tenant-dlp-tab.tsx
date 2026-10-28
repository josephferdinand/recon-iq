import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getDlpPolicy, updateDlpPolicy, resolveDlpFinding } from "@/lib/tenant-security.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ShieldAlert, Save, Check } from "lucide-react";

type Policy = {
  enabled: boolean;
  detect_pan: boolean; detect_iban: boolean; detect_ssn: boolean;
  detect_email: boolean; detect_aba: boolean; detect_swift_bic: boolean;
  default_action: "allow" | "redact" | "block";
  block_on_high: boolean;
};

const DEFAULT: Policy = {
  enabled: true,
  detect_pan: true, detect_iban: true, detect_ssn: true,
  detect_email: false, detect_aba: true, detect_swift_bic: true,
  default_action: "redact", block_on_high: true,
};

export function TenantDlpTab({ tenantId, canWrite }: { tenantId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const get = useServerFn(getDlpPolicy);
  const upd = useServerFn(updateDlpPolicy);
  const resolve = useServerFn(resolveDlpFinding);

  const q = useQuery({
    queryKey: ["tenant-dlp", tenantId],
    queryFn: () => get({ data: { tenant_id: tenantId } }),
  });

  const [policy, setPolicy] = useState<Policy>(DEFAULT);
  useEffect(() => {
    if (q.data?.policy) setPolicy({ ...DEFAULT, ...(q.data.policy as any) });
  }, [q.data?.policy]);

  const save = useMutation({
    mutationFn: () => upd({ data: { tenant_id: tenantId, ...policy } }),
    onSuccess: () => {
      toast.success("DLP policy saved");
      qc.invalidateQueries({ queryKey: ["tenant-dlp", tenantId] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const [resolutionDrafts, setResolutionDrafts] = useState<Record<string, string>>({});
  const resM = useMutation({
    mutationFn: (v: { id: string; resolution: string }) =>
      resolve({ data: { tenant_id: tenantId, ...v } }),
    onSuccess: () => {
      toast.success("Finding resolved");
      qc.invalidateQueries({ queryKey: ["tenant-dlp", tenantId] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const findings = q.data?.recent ?? [];
  const openHigh = q.data?.open_high ?? 0;

  const toggles: [keyof Policy, string, string][] = [
    ["detect_pan", "PAN (card numbers)", "Payment card industry primary account numbers"],
    ["detect_iban", "IBAN", "International bank account numbers"],
    ["detect_aba", "ABA routing", "US ABA routing numbers"],
    ["detect_swift_bic", "SWIFT / BIC", "Bank identifier codes"],
    ["detect_ssn", "SSN", "US social security numbers"],
    ["detect_email", "Emails", "Email addresses (usually noisy)"],
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4" /> Data Loss Prevention (DLP)
            {openHigh > 0 ? <Badge variant="destructive">{openHigh} open high</Badge> : null}
          </CardTitle>
          <CardDescription>
            Scan every ingested file and API payload for sensitive patterns. Findings can be redacted, blocked, or allowed with review.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <div className="font-medium">DLP scanning</div>
              <p className="text-xs text-muted-foreground">Master switch for this tenant.</p>
            </div>
            <Switch
              checked={policy.enabled}
              disabled={!canWrite}
              onCheckedChange={(v) => setPolicy({ ...policy, enabled: v })}
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {toggles.map(([key, label, desc]) => (
              <div key={key} className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <div className="text-sm font-medium">{label}</div>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                </div>
                <Switch
                  checked={Boolean(policy[key])}
                  disabled={!canWrite || !policy.enabled}
                  onCheckedChange={(v) => setPolicy({ ...policy, [key]: v } as Policy)}
                />
              </div>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <div className="text-xs text-muted-foreground mb-1">Default action on match</div>
              <Select
                value={policy.default_action}
                onValueChange={(v) => setPolicy({ ...policy, default_action: v as any })}
                disabled={!canWrite || !policy.enabled}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="allow">Allow (log only)</SelectItem>
                  <SelectItem value="redact">Redact match in stored data</SelectItem>
                  <SelectItem value="block">Block ingestion</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <div className="text-sm font-medium">Always block on high severity</div>
                <p className="text-xs text-muted-foreground">Overrides default action when confidence is high.</p>
              </div>
              <Switch
                checked={policy.block_on_high}
                disabled={!canWrite || !policy.enabled}
                onCheckedChange={(v) => setPolicy({ ...policy, block_on_high: v })}
              />
            </div>
          </div>
          {canWrite ? (
            <div className="flex justify-end">
              <Button onClick={() => save.mutate()} disabled={save.isPending}>
                <Save className="h-4 w-4 mr-1" /> Save policy
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent scan findings</CardTitle>
          <CardDescription>Last 50 events across all sources.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2">When</th>
                <th className="px-4 py-2">Source</th>
                <th className="px-4 py-2">Severity</th>
                <th className="px-4 py-2">Action</th>
                <th className="px-4 py-2">Matches</th>
                <th className="px-4 py-2">Resolution</th>
              </tr>
            </thead>
            <tbody>
              {findings.map((f: any) => (
                <tr key={f.id} className="border-b align-top">
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {new Date(f.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    <div className="font-medium">{f.source_kind}</div>
                    <div className="text-muted-foreground">{f.filename ?? f.source_id}</div>
                  </td>
                  <td className="px-4 py-2">
                    <Badge variant={f.severity === "high" || f.severity === "critical" ? "destructive" : "outline"}>
                      {f.severity ?? "—"}
                    </Badge>
                  </td>
                  <td className="px-4 py-2 text-xs">{f.action_taken ?? "—"}</td>
                  <td className="px-4 py-2 text-xs">
                    {Array.isArray(f.matches) ? f.matches.length : (f.matches ? Object.keys(f.matches).length : 0)}
                  </td>
                  <td className="px-4 py-2">
                    {f.reviewed_at ? (
                      <Badge variant="secondary">Reviewed</Badge>
                    ) : canWrite ? (
                      <div className="flex gap-1">
                        <Input
                          value={resolutionDrafts[f.id] ?? ""}
                          onChange={(e) => setResolutionDrafts({ ...resolutionDrafts, [f.id]: e.target.value })}
                          placeholder="Resolution notes"
                          className="h-8"
                        />
                        <Button size="sm" variant="ghost"
                          disabled={!resolutionDrafts[f.id] || resM.isPending}
                          onClick={() => resM.mutate({ id: f.id, resolution: resolutionDrafts[f.id] })}
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">Open</span>
                    )}
                  </td>
                </tr>
              ))}
              {findings.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No DLP findings yet.</td></tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
