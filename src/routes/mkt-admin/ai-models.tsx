import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { notifyUserError } from "@/lib/user-feedback";
import { listLlmProviders, upsertLlmProvider } from "@/lib/mkt-admin.functions";
import {
  getFxRate, setFxRate,
  listLlmRoutes, upsertLlmRoute,
  testLlmProviders, deleteLlmProvider, llmUsageStats,
} from "@/lib/mkt-llm-ops.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { Trash2, Play, KeyRound, Sparkles, RefreshCw, DollarSign } from "lucide-react";

export const Route = createFileRoute("/mkt-admin/ai-models")({
  component: LlmModels,
});

const PROVIDERS = ["byok","azure_muse","muse","anthropic","google","mistral","groq","openrouter"] as const;
type Provider = typeof PROVIDERS[number];
const PURPOSES = [
  { key: "chatbot", label: "ReconIQ Copilot Chatbot" },
  { key: "kb_embed", label: "Knowledge base embeddings" },
  { key: "summarize", label: "Summaries & rewrites" },
] as const;

const PROVIDER_DEFAULTS: Record<Provider, { display_name: string; base_url: string; default_model: string }> = {
  byok:         { display_name: "BYO LLM Key",        base_url: "https://api.meta.ai/v1",                 default_model: "gpt-4o-mini" },
  azure_muse: { display_name: "Azure Muse",       base_url: "",                                          default_model: "gpt-4o-mini" },
  muse:       { display_name: "Muse",             base_url: "https://api.meta.ai/v1",                 default_model: "gpt-4o-mini" },
  anthropic:    { display_name: "Anthropic",          base_url: "https://api.anthropic.com/v1",              default_model: "claude-3-5-haiku-20241022" },
  google:       { display_name: "Google (Gemini)",    base_url: "https://generativelanguage.googleapis.com/v1beta/muse", default_model: "gemini-1.5-flash" },
  mistral:      { display_name: "Mistral",            base_url: "https://api.mistral.ai/v1",                 default_model: "mistral-small-latest" },
  groq:         { display_name: "Groq",               base_url: "https://api.groq.com/muse/v1",            default_model: "llama-3.1-8b-instant" },
  openrouter:   { display_name: "OpenRouter",         base_url: "https://openrouter.ai/api/v1",              default_model: "muse/gpt-4o-mini" },
};

type Row = {
  id: string; provider: string; display_name: string;
  base_url: string | null; default_model: string | null;
  api_key_ref: string | null; enabled: boolean; priority: number;
};

export function providerTestGuidance(status: number, detail?: string): string {
  if (detail === "disabled") return "This provider is disabled. Enable it before testing the connection.";
  if (detail === "missing base_url") return "A provider URL is required. Add the provider's base URL, then test again.";
  if (detail === "missing vault secret (api_key_ref)") return "The vault secret reference is missing. Add the environment variable name for the stored provider key, then test again.";
  if (status === 0) return "The provider could not be reached. Check the base URL and network access, then try again.";
  if (status === 401 || status === 403) return "The provider did not accept the configured credentials. Check the vault secret reference and provider permissions.";
  if (status === 429) return "The provider is temporarily limiting requests. Wait a moment and try again.";
  if (status >= 500) return "The provider is temporarily unavailable. Try again shortly.";
  if (status >= 400) return "The provider rejected the test request. Check the base URL and model configuration.";
  return "The provider test did not complete. Review its configuration and try again.";
}

function LlmModels() {
  const qc = useQueryClient();
  const listFn = useServerFn(listLlmProviders);
  const upFn = useServerFn(upsertLlmProvider);
  const delFn = useServerFn(deleteLlmProvider);
  const testFn = useServerFn(testLlmProviders);
  const routesFn = useServerFn(listLlmRoutes);
  const upsertRouteFn = useServerFn(upsertLlmRoute);
  const statsFn = useServerFn(llmUsageStats);
  const fxGetFn = useServerFn(getFxRate);
  const fxSetFn = useServerFn(setFxRate);

  const providersQ = useQuery({ queryKey: ["mkt","llm","providers"], queryFn: () => listFn({ data: undefined }) });
  const routesQ = useQuery({ queryKey: ["mkt","llm","routes"], queryFn: () => routesFn({ data: undefined }) });
  const fxQ = useQuery({ queryKey: ["mkt","fx"], queryFn: () => fxGetFn({ data: undefined }) });
  const [days, setDays] = useState(30);
  const [currency, setCurrency] = useState<"USD" | "INR">("USD");
  const statsQ = useQuery({ queryKey: ["mkt","llm","stats", days], queryFn: () => statsFn({ data: { days } }) });

  const [form, setForm] = useState<{ id?: string; provider: Provider; display_name: string; base_url: string; default_model: string; api_key_ref: string; enabled: boolean; priority: number; notes: string }>({
    provider: "byok",
    display_name: PROVIDER_DEFAULTS.byok.display_name,
    base_url: PROVIDER_DEFAULTS.byok.base_url,
    default_model: PROVIDER_DEFAULTS.byok.default_model,
    api_key_ref: "", enabled: true, priority: 10, notes: "",
  });

  const resetForm = () => setForm({
    provider: "byok",
    display_name: PROVIDER_DEFAULTS.byok.display_name,
    base_url: PROVIDER_DEFAULTS.byok.base_url,
    default_model: PROVIDER_DEFAULTS.byok.default_model,
    api_key_ref: "", enabled: true, priority: 10, notes: "",
  });

  const saveMut = useMutation({
    mutationFn: () => upFn({ data: {
      id: form.id,
      provider: form.provider,
      display_name: form.display_name,
      base_url: form.base_url || null,
      default_model: form.default_model || null,
      api_key_ref: form.api_key_ref || null,
      notes: form.notes || null,
      enabled: form.enabled,
      priority: form.priority,
    } }),
    onSuccess: () => { toast.success("Saved"); resetForm(); qc.invalidateQueries({ queryKey: ["mkt","llm"] }); },
    onError: (e) => notifyUserError(e, "AI model provider save"),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => { toast.success("Deleted"); qc.invalidateQueries({ queryKey: ["mkt","llm"] }); },
    onError: (e) => notifyUserError(e, "AI model provider delete"),
  });

  const [testResults, setTestResults] = useState<Awaited<ReturnType<typeof testFn>> | null>(null);
  const [testing, setTesting] = useState(false);
  const runTestAll = async () => {
    setTesting(true);
    try {
      const r = await testFn({ data: {} });
      setTestResults(r);
      const ok = r.filter((x) => x.ok).length;
      toast[ok === r.length ? "success" : "warning" as "success"](`Tested ${r.length} providers — ${ok} OK, ${r.length - ok} failed`);
    } catch (e) { notifyUserError(e, "AI model provider tests"); }
    finally { setTesting(false); }
  };
  const runTestOne = async (id: string) => {
    setTesting(true);
    try {
      const r = await testFn({ data: { ids: [id] } });
      setTestResults((prev) => {
        const others = (prev ?? []).filter((x) => x.id !== id);
        return [...others, ...r];
      });
      const first = r[0];
      if (first?.ok) toast.success(`${first.display_name}: ${first.latency_ms}ms`);
      else toast.error(`${first?.display_name ?? "Provider test failed"}`, { description: providerTestGuidance(first?.status ?? 0, first?.error) });
    } catch (e) {
      notifyUserError(e, "AI model provider test");
    } finally { setTesting(false); }
  };

  const fxRate = fxQ.data?.usd_to_inr ?? 83.5;
  const [fxDraft, setFxDraft] = useState<string>("");
  const fxMut = useMutation({
    mutationFn: (n: number) => fxSetFn({ data: { usd_to_inr: n } }),
    onSuccess: () => { toast.success("FX rate updated"); qc.invalidateQueries({ queryKey: ["mkt","fx"] }); setFxDraft(""); },
    onError: (e) => notifyUserError(e, "AI model exchange rate update"),
  });

  const fmtMoney = (usd: number) => {
    if (currency === "USD") return `$${usd.toFixed(2)}`;
    return `₹${(usd * fxRate).toFixed(2)}`;
  };

  const providers: Row[] = (providersQ.data as Row[] | undefined) ?? [];

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-2xl font-semibold">AI models</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Bring your own LLM key. Configure a primary + up to 3 fallbacks per purpose, test the full failover chain, and track spend in USD or INR.
        </p>
      </header>

      {/* -------- Add/edit provider -------- */}
      <Card className="p-5">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <KeyRound className="h-4 w-4" /> {form.id ? "Edit provider" : "Add BYOK provider"}
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <Label>Provider</Label>
            <select aria-label="Provider type" value={form.provider}
              onChange={(e) => {
                const p = e.target.value as Provider;
                const d = PROVIDER_DEFAULTS[p];
                setForm({ ...form, provider: p, display_name: d.display_name, base_url: d.base_url, default_model: d.default_model });
              }}
              className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm">
              {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div><Label>Display name</Label><Input aria-label="Provider display name" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} /></div>
          <div><Label>Default model</Label><Input aria-label="Default provider model" value={form.default_model} onChange={(e) => setForm({ ...form, default_model: e.target.value })} /></div>
          <div className="md:col-span-2"><Label>Base URL (Muse-compatible)</Label><Input aria-label="Provider base URL" value={form.base_url} placeholder="https://..." onChange={(e) => setForm({ ...form, base_url: e.target.value })} /></div>
          <div><Label>Priority (lower = higher)</Label><Input aria-label="Provider priority" type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })} /></div>
          <div className="md:col-span-2">
            <Label>Vault secret name (env var)</Label>
            <Input aria-label="Vault secret environment variable name" placeholder="e.g. MUSE_API_KEY" value={form.api_key_ref} onChange={(e) => setForm({ ...form, api_key_ref: e.target.value })} />
            <p className="mt-1 text-xs text-muted-foreground">Name of the secret in the Enterprise Vault. The plaintext key itself is stored only in the vault and never in this table.</p>
          </div>
          <div className="flex items-end gap-2">
            <Switch aria-label="Provider enabled" checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} />
            <span className="text-sm">Enabled</span>
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>{form.id ? "Update" : "Add"} provider</Button>
          {form.id && <Button variant="ghost" onClick={resetForm}>Cancel edit</Button>}
        </div>
      </Card>

      {/* -------- Providers list -------- */}
      <Card>
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="text-sm font-semibold">Configured providers</div>
          <Button size="sm" variant="outline" onClick={runTestAll} disabled={testing}>
            <Play className="mr-1 h-4 w-4" />Test all
          </Button>
        </div>
        <ul className="divide-y divide-border">
          {providers.map((p) => {
            const tr = testResults?.find((x) => x.id === p.id);
            return (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {p.display_name}
                    <span className="text-xs text-muted-foreground">· {p.provider}</span>
                    <Badge variant={p.enabled ? "default" : "outline"}>{p.enabled ? "enabled" : "disabled"}</Badge>
                    {p.api_key_ref ? <Badge variant="secondary">vault: {p.api_key_ref}</Badge> : <Badge variant="outline">no vault ref</Badge>}
                    {tr && (tr.ok
                      ? <Badge className="bg-emerald-600 text-white">OK · {tr.latency_ms}ms</Badge>
                      : <Badge variant="destructive">Needs attention</Badge>)}
                  </div>
                  <div className="text-xs text-muted-foreground">{p.default_model ?? "—"} · priority {p.priority}</div>
                  {tr && !tr.ok && <div className="mt-1 text-xs text-destructive">{providerTestGuidance(tr.status, tr.error)}</div>}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => runTestOne(p.id)} disabled={testing}><Play className="mr-1 h-3.5 w-3.5" />Test</Button>
                  <Button size="sm" variant="outline" onClick={() => setForm({
                    id: p.id, provider: (p.provider as Provider), display_name: p.display_name,
                    base_url: p.base_url ?? "", default_model: p.default_model ?? "",
                    api_key_ref: p.api_key_ref ?? "", enabled: p.enabled, priority: p.priority, notes: "",
                  })}>Edit</Button>
                  <Button aria-label={`Delete ${p.display_name}`} size="sm" variant="ghost" onClick={() => { if (confirm("Delete this provider?")) delMut.mutate(p.id); }}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            );
          })}
          {providers.length === 0 && <li className="px-5 py-6 text-center text-sm text-muted-foreground">No providers yet — add your first BYOK key above.</li>}
        </ul>
      </Card>

      {/* -------- Failover routing -------- */}
      <Card className="p-5">
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <Sparkles className="h-4 w-4" /> Failover routing (primary + up to 3 fallbacks)
        </div>
        <div className="grid gap-4">
          {PURPOSES.map((pu) => (
            <RouteRow key={pu.key} purpose={pu.key} label={pu.label}
              route={(routesQ.data ?? []).find((r: { purpose: string }) => r.purpose === pu.key)}
              providers={providers}
              onSave={async (payload) => {
                try {
                  await upsertRouteFn({ data: payload });
                  qc.invalidateQueries({ queryKey: ["mkt","llm","routes"] });
                  toast.success(`${pu.label} route saved`);
                } catch (e) {
                  notifyUserError(e, "AI model failover route save");
                }
              }}
              onTestChain={async (ids) => {
                if (!ids.length) { toast.error("No providers in chain"); return; }
                setTesting(true);
                try {
                  const r = await testFn({ data: { ids } });
                  setTestResults(r);
                  const ok = r.filter((x) => x.ok).length;
                  if (ok === r.length) toast.success(`${pu.label}: ${ok}/${r.length} OK`);
                  else toast.warning(`${pu.label}: ${ok}/${r.length} providers responded`, { description: "Check the provider guidance below and update the configuration before relying on this failover chain." });
                } catch (e) {
                  notifyUserError(e, "AI model failover chain test");
                } finally { setTesting(false); }
              }}
            />
          ))}
        </div>
      </Card>

      {/* -------- Usage & cost dashboard -------- */}
      <Card className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <DollarSign className="h-4 w-4" /> LLM usage & cost
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Usage reporting period" value={days} onChange={(e) => setDays(Number(e.target.value))}
              className="h-8 rounded-md border border-border bg-background px-2 text-xs">
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
            <div className="inline-flex overflow-hidden rounded-md border border-border">
              {(["USD","INR"] as const).map((c) => (
                <button key={c} onClick={() => setCurrency(c)}
                  className={`px-3 py-1.5 text-xs ${currency === c ? "bg-primary text-primary-foreground" : "bg-background text-foreground"}`}>{c}</button>
              ))}
            </div>
            <div className="flex items-center gap-1">
              <Label className="text-xs text-muted-foreground">1 USD =</Label>
              <Input aria-label="USD to INR exchange rate" className="h-8 w-24" placeholder={String(fxRate)} value={fxDraft} onChange={(e) => setFxDraft(e.target.value)} />
              <span className="text-xs text-muted-foreground">INR</span>
              <Button aria-label="Update exchange rate" size="sm" variant="outline" onClick={() => { const n = Number(fxDraft); if (n > 0) fxMut.mutate(n); }} disabled={!fxDraft || fxMut.isPending}>
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-4">
          <Kpi label="Total spend" value={fmtMoney(statsQ.data?.totals.cost_usd ?? 0)} />
          <Kpi label="Calls" value={String(statsQ.data?.totals.calls ?? 0)} />
          <Kpi label="Success rate" value={`${((statsQ.data?.totals.ok_rate ?? 1) * 100).toFixed(1)}%`} />
          <Kpi label="Avg latency" value={`${statsQ.data?.totals.avg_latency_ms ?? 0} ms`} />
        </div>

        <div className="mt-6">
          <div className="mb-2 text-xs font-medium text-muted-foreground">By provider</div>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Provider</th>
                  <th className="px-3 py-2">Calls</th>
                  <th className="px-3 py-2">OK</th>
                  <th className="px-3 py-2">Tokens</th>
                  <th className="px-3 py-2">Avg latency</th>
                  <th className="px-3 py-2">Spend ({currency})</th>
                </tr>
              </thead>
              <tbody>
                {(statsQ.data?.byProvider ?? []).map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-3 py-2">{r.name} <span className="text-xs text-muted-foreground">· {r.provider}</span></td>
                    <td className="px-3 py-2">{r.calls}</td>
                    <td className="px-3 py-2">{r.ok}</td>
                    <td className="px-3 py-2">{r.tokens_in + r.tokens_out}</td>
                    <td className="px-3 py-2">{r.calls ? Math.round(r.latency_sum / r.calls) : 0} ms</td>
                    <td className="px-3 py-2 font-medium">{fmtMoney(r.cost_usd)}</td>
                  </tr>
                ))}
                {(statsQ.data?.byProvider ?? []).length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-muted-foreground">No usage recorded yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6">
          <div className="mb-2 text-xs font-medium text-muted-foreground">Daily spend</div>
          <MiniBars data={(statsQ.data?.byDay ?? []).map((d) => ({ label: d.day.slice(5), value: currency === "USD" ? d.cost_usd : d.cost_usd * fxRate }))} suffix={currency === "USD" ? "$" : "₹"} />
        </div>
      </Card>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-display text-xl font-semibold">{value}</div>
    </div>
  );
}

function MiniBars({ data, suffix }: { data: { label: string; value: number }[]; suffix: string }) {
  const max = useMemo(() => Math.max(1, ...data.map((d) => d.value)), [data]);
  if (!data.length) return <div className="text-xs text-muted-foreground">No data.</div>;
  return (
    <div className="flex h-40 items-end gap-1 rounded-md border border-border bg-muted/20 p-3">
      {data.map((d) => (
        <div key={d.label} className="flex flex-1 flex-col items-center gap-1" title={`${d.label}: ${suffix}${d.value.toFixed(2)}`}>
          <div className="w-full rounded-t bg-primary" style={{ height: `${(d.value / max) * 100}%` }} />
          <div className="text-[10px] text-muted-foreground">{d.label}</div>
        </div>
      ))}
    </div>
  );
}

function RouteRow({ purpose, label, route, providers, onSave, onTestChain }: {
  purpose: "chatbot" | "kb_embed" | "summarize";
  label: string;
  route?: { primary_id: string | null; fallback_ids: string[] };
  providers: Row[];
  onSave: (r: { purpose: "chatbot" | "kb_embed" | "summarize"; primary_id: string | null; fallback_ids: string[] }) => void | Promise<void>;
  onTestChain: (ids: string[]) => void | Promise<void>;
}) {
  const [primary, setPrimary] = useState<string>(route?.primary_id ?? "");
  const [fb1, setFb1] = useState<string>(route?.fallback_ids?.[0] ?? "");
  const [fb2, setFb2] = useState<string>(route?.fallback_ids?.[1] ?? "");
  const [fb3, setFb3] = useState<string>(route?.fallback_ids?.[2] ?? "");
  const chain = [primary, fb1, fb2, fb3].filter(Boolean);

  const Sel = ({ value, onChange, placeholder, ariaLabel }: { value: string; onChange: (v: string) => void; placeholder: string; ariaLabel: string }) => (
    <select aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)}
      className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm">
      <option value="">{placeholder}</option>
      {providers.map((p) => <option key={p.id} value={p.id} disabled={!p.enabled}>{p.display_name} ({p.provider}){p.enabled ? "" : " — off"}</option>)}
    </select>
  );

  return (
    <div className="rounded-md border border-border p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="font-medium">{label}</div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => onTestChain(chain)}><Play className="mr-1 h-3.5 w-3.5" />Test chain</Button>
          <Button size="sm" onClick={() => onSave({ purpose, primary_id: primary || null, fallback_ids: [fb1, fb2, fb3].filter(Boolean) })}>Save</Button>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <div><Label className="text-xs">Primary</Label><Sel ariaLabel={`${label} primary provider`} value={primary} onChange={setPrimary} placeholder="— select —" /></div>
        <div><Label className="text-xs">Fallback 1</Label><Sel ariaLabel={`${label} fallback provider 1`} value={fb1} onChange={setFb1} placeholder="— none —" /></div>
        <div><Label className="text-xs">Fallback 2</Label><Sel ariaLabel={`${label} fallback provider 2`} value={fb2} onChange={setFb2} placeholder="— none —" /></div>
        <div><Label className="text-xs">Fallback 3</Label><Sel ariaLabel={`${label} fallback provider 3`} value={fb3} onChange={setFb3} placeholder="— none —" /></div>
      </div>
    </div>
  );
}
