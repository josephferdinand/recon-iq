import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getPlatformAiSettings, updatePlatformAiSettings, listModelPricing, upsertModelPricing } from "@/lib/platform-ai.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Shield, DollarSign } from "lucide-react";
import { toast } from "sonner";

export function PlatformAiGovernanceTab() {
  const qc = useQueryClient();
  const getFn = useServerFn(getPlatformAiSettings);
  const updFn = useServerFn(updatePlatformAiSettings);
  const listPriceFn = useServerFn(listModelPricing);
  const upPriceFn = useServerFn(upsertModelPricing);

  const q = useQuery({ queryKey: ["platform-ai"], queryFn: () => getFn() });
  const priceQ = useQuery({ queryKey: ["model-pricing"], queryFn: () => listPriceFn() });

  const [s, setS] = useState<any>(null);
  useEffect(() => { if (q.data) setS(q.data); }, [q.data]);

  const m = useMutation({
    mutationFn: (v: any) => updFn({ data: v }),
    onSuccess: () => { toast.success("Platform AI settings updated"); qc.invalidateQueries({ queryKey: ["platform-ai"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const mp = useMutation({
    mutationFn: (v: any) => upPriceFn({ data: v }),
    onSuccess: () => { toast.success("Pricing updated"); qc.invalidateQueries({ queryKey: ["model-pricing"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  if (!s) return <div className="text-sm text-muted-foreground">Loading…</div>;
  const set = (k: string, v: any) => setS({ ...s, [k]: v });

  const save = () => {
    const { id: _id, updated_by: _ub, updated_at: _ua, ...rest } = s;
    m.mutate(rest);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Shield className="h-4 w-4" /> Platform AI Governance</CardTitle>
          <CardDescription>Global ceilings. Tenant settings cannot exceed what is allowed here.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          {[
            ["allow_copilot_global", "Allow Copilot globally"],
            ["allow_agent_global", "Allow autonomous agent globally"],
            ["allow_auto_remediation_global", "Allow auto-remediation globally"],
            ["allow_byo_llm_global", "Allow BYO-LLM globally"],
            ["force_pii_redaction", "Force PII redaction on all tenants"],
            ["force_log_prompts", "Force prompt logging"],
          ].map(([k, label]) => (
            <div key={k} className="flex items-center justify-between rounded-md border p-3">
              <Label className="text-sm">{label}</Label>
              <Switch checked={!!s[k as string]} onCheckedChange={(v) => set(k as string, v)} />
            </div>
          ))}
          <div className="space-y-1">
            <Label>Default model</Label>
            <Input value={s.default_model} onChange={(e) => set("default_model", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Autonomy ceiling</Label>
            <Select value={s.default_autonomy_ceiling} onValueChange={(v) => set("default_autonomy_ceiling", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="suggest">Suggest only</SelectItem>
                <SelectItem value="assist">Assisted</SelectItem>
                <SelectItem value="auto">Autonomous</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Global max tokens / day</Label>
            <Input type="number" value={s.global_max_tokens_per_day} onChange={(e) => set("global_max_tokens_per_day", Number(e.target.value))} />
          </div>
          <div className="space-y-1">
            <Label>Global max agent runs / day</Label>
            <Input type="number" value={s.global_max_agent_runs_per_day} onChange={(e) => set("global_max_agent_runs_per_day", Number(e.target.value))} />
          </div>
          <div className="space-y-1">
            <Label>Global max cost / day (USD)</Label>
            <Input type="number" value={s.global_max_cost_usd_per_day} onChange={(e) => set("global_max_cost_usd_per_day", Number(e.target.value))} />
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label>Globally allowed models (comma-separated)</Label>
            <Input value={(s.global_allowed_models ?? []).join(", ")}
              onChange={(e) => set("global_allowed_models", e.target.value.split(",").map((x) => x.trim()).filter(Boolean))} />
          </div>
          <div className="md:col-span-2 flex justify-end">
            <Button disabled={m.isPending} onClick={save}>{m.isPending ? "Saving…" : "Save"}</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><DollarSign className="h-4 w-4" /> Model rate card</CardTitle>
          <CardDescription>USD per 1k tokens. Used by cost metering for every AI call.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr><th className="px-4 py-2">Model</th><th className="px-4 py-2">Input</th><th className="px-4 py-2">Output</th><th className="px-4 py-2" /></tr>
            </thead>
            <tbody>
              {(priceQ.data ?? []).map((r: any) => (
                <PriceRow key={r.model} row={r} onSave={(v) => mp.mutate(v)} />
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function PriceRow({ row, onSave }: { row: any; onSave: (v: any) => void }) {
  const [inP, setIn] = useState(String(row.input_per_1k_usd));
  const [outP, setOut] = useState(String(row.output_per_1k_usd));
  const dirty = inP !== String(row.input_per_1k_usd) || outP !== String(row.output_per_1k_usd);
  return (
    <tr className="border-b">
      <td className="px-4 py-2 font-mono text-xs">{row.model}</td>
      <td className="px-4 py-2"><Input className="h-8 w-32" value={inP} onChange={(e) => setIn(e.target.value)} /></td>
      <td className="px-4 py-2"><Input className="h-8 w-32" value={outP} onChange={(e) => setOut(e.target.value)} /></td>
      <td className="px-4 py-2 text-right">
        <Button size="sm" variant={dirty ? "default" : "ghost"} disabled={!dirty}
          onClick={() => onSave({ model: row.model, input_per_1k_usd: Number(inP), output_per_1k_usd: Number(outP) })}>
          Save
        </Button>
      </td>
    </tr>
  );
}
