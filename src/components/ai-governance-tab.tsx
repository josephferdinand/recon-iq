import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getAiSettings, upsertAiSettings } from "@/lib/ai-governance.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Shield } from "lucide-react";
import { toast } from "sonner";

export function AiGovernanceTab({ tenantId, canWrite }: { tenantId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const get = useServerFn(getAiSettings);
  const save = useServerFn(upsertAiSettings);
  const q = useQuery({ queryKey: ["ai-gov", tenantId], queryFn: () => get({ data: { tenant_id: tenantId } }) });
  const [s, setS] = useState<any>(null);
  useEffect(() => { if (q.data) setS(q.data); }, [q.data]);

  const m = useMutation({
    mutationFn: (v: any) => save({ data: v }),
    onSuccess: () => { toast.success("AI governance saved"); qc.invalidateQueries({ queryKey: ["ai-gov", tenantId] }); },
    onError: (e: any) => toast.error(e.message),
  });

  if (!s) return <div className="text-sm text-muted-foreground">Loading…</div>;
  const set = (k: string, v: any) => setS({ ...s, [k]: v });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Shield className="h-4 w-4" /> AI Governance</CardTitle>
        <CardDescription>Control which AI capabilities tenant users can access and how they behave by default.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        {[
          ["allow_copilot", "Allow Copilot chat"],
          ["allow_agent", "Allow autonomous agent"],
          ["allow_auto_remediation", "Allow auto-remediation"],
          ["allow_byo_llm", "Allow BYO LLM providers"],
          ["redact_pii_default", "Redact PII by default"],
          ["log_prompts", "Log prompts for audit"],
        ].map(([k, label]) => (
          <div key={k} className="flex items-center justify-between rounded-md border p-3">
            <Label htmlFor={k} className="text-sm">{label}</Label>
            <Switch id={k} checked={!!s[k]} disabled={!canWrite} onCheckedChange={(v) => set(k, v)} />
          </div>
        ))}
        <div className="space-y-1">
          <Label>Default model</Label>
          <Input value={s.default_model} disabled={!canWrite} onChange={(e) => set("default_model", e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Default autonomy</Label>
          <Select value={s.default_autonomy} disabled={!canWrite} onValueChange={(v) => set("default_autonomy", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="read_only">Read-only</SelectItem>
              <SelectItem value="supervised">Supervised</SelectItem>
              <SelectItem value="autonomous">Autonomous</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Max tokens / day</Label>
          <Input type="number" value={s.max_tokens_per_day} disabled={!canWrite}
            onChange={(e) => set("max_tokens_per_day", Number(e.target.value))} />
        </div>
        <div className="space-y-1">
          <Label>Max agent runs / day</Label>
          <Input type="number" value={s.max_agent_runs_per_day} disabled={!canWrite}
            onChange={(e) => set("max_agent_runs_per_day", Number(e.target.value))} />
        </div>
        <div className="space-y-1 md:col-span-2">
          <Label>Allowed models (comma-separated, empty = any)</Label>
          <Input value={(s.allowed_models ?? []).join(", ")} disabled={!canWrite}
            onChange={(e) => set("allowed_models", e.target.value.split(",").map((x) => x.trim()).filter(Boolean))} />
        </div>
        <div className="md:col-span-2 flex justify-end">
          <Button disabled={!canWrite || m.isPending} onClick={() => m.mutate(s)}>
            {m.isPending ? "Saving…" : "Save governance"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
