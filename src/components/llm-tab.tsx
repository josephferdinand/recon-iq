import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listLlmProviders, upsertLlmProvider, deleteLlmProvider,
  testLlmProvider, testLlmChain, preflightLlmChain,
  getAiEnabled, setAiEnabled,
  getLlmRateLimits, setLlmRateLimits,
  getLlmFallbackSetting,
} from "@/lib/llm.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/password-input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertCircle, ArrowRight, CheckCircle2, Crown, Eye, EyeOff, Fingerprint, Gauge, KeyRound, Loader2, MinusCircle, Sparkles, Trash2, XCircle, Zap } from "lucide-react";
import { toast } from "sonner";

type ProviderKey =
  | "anthropic" | "muse" | "google" | "mistral" | "cohere"
  | "groq" | "perplexity" | "deepseek" | "xai"
  | "custom_muse_compatible";


type SlotIndex = 0 | 1 | 2 | 3;
const SLOTS: { idx: SlotIndex; label: string }[] = [
  { idx: 0, label: "Primary" },
  { idx: 1, label: "Fallback #1" },
  { idx: 2, label: "Fallback #2" },
  { idx: 3, label: "Fallback #3" },
];

const PROVIDERS: Record<ProviderKey, { label: string; models: string[]; requires_base_url?: boolean; default_base_url?: string }> = {
  anthropic:  { label: "Anthropic",   models: ["claude-sonnet-4-5", "claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022", "claude-opus-4-1"] },
  muse:     { label: "Muse",      models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-5", "gpt-5-mini"] },
  google:     { label: "Google",      models: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"] },
  mistral:    { label: "Mistral AI",  models: ["mistral-large-latest", "mistral-medium-latest", "mistral-small-latest"] },
  cohere:     { label: "Cohere",      models: ["command-r-plus", "command-r"] },
  groq:       { label: "Groq",        models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"] },
  perplexity: { label: "Perplexity",  models: ["llama-3.1-sonar-large-128k-online", "llama-3.1-sonar-small-128k-online"] },
  deepseek:   { label: "DeepSeek",    models: ["deepseek-chat", "deepseek-reasoner"] },
  xai:        { label: "xAI Grok",    models: ["grok-2-latest", "grok-2-mini"] },
  custom_muse_compatible: { label: "Custom (Muse-compatible)", models: [], requires_base_url: true },

};

type SlotForm = {
  provider: ProviderKey;
  base_url: string;
  model: string;
  modelMode: "preset" | "custom";
  api_key: string;
  is_active: boolean;
};

const emptySlot = (): SlotForm => ({
  provider: "anthropic",
  base_url: "",
  model: PROVIDERS.anthropic.models[0],
  modelMode: "preset",
  api_key: "",
  is_active: true,
});

function providerLabel(p?: string) {
  return p ? (PROVIDERS as any)[p]?.label ?? p : "—";
}

function StatusPill({ result }: { result?: { ok: boolean; latency_ms: number; error?: string } }) {
  if (!result) return <span className="text-xs italic text-muted-foreground">Not tested yet — save first, then test.</span>;
  if (result.ok) return (
    <span className="inline-flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
      <CheckCircle2 className="h-3.5 w-3.5" /> OK · {result.latency_ms} ms
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-destructive" title={result.error}>
      <XCircle className="h-3.5 w-3.5" /> Failed {result.latency_ms ? `· ${result.latency_ms} ms` : ""}
    </span>
  );
}

export function LlmTab({ scope, tenantId }: { scope: "platform" | "tenant"; tenantId?: string }) {
  const qc = useQueryClient();
  const list      = useServerFn(listLlmProviders);
  const upsert    = useServerFn(upsertLlmProvider);
  const del       = useServerFn(deleteLlmProvider);
  const test1     = useServerFn(testLlmProvider);
  const testAll   = useServerFn(testLlmChain);
  const preflight = useServerFn(preflightLlmChain);
  const getAi     = useServerFn(getAiEnabled);
  const setAi     = useServerFn(setAiEnabled);
  const getRl     = useServerFn(getLlmRateLimits);
  const setRl     = useServerFn(setLlmRateLimits);
  const getGw     = useServerFn(getLlmFallbackSetting);

  const providersQ = useQuery({
    queryKey: ["llm", scope, tenantId ?? null],
    queryFn: () => list({ data: { scope, tenant_id: tenantId } }),
  });
  const aiEnabledQ = useQuery({
    queryKey: ["llm-ai-enabled", scope, tenantId ?? null],
    queryFn: () => getAi({ data: { scope, tenant_id: tenantId } }),
  });
  const rateLimitsQ = useQuery({
    queryKey: ["llm-rate-limits", scope, tenantId ?? null],
    queryFn: () => getRl({ data: { scope, tenant_id: tenantId } }),
  });
  const gatewayQ = useQuery({
    queryKey: ["llm-gateway-fallback", scope, tenantId ?? null],
    queryFn: () => getGw({ data: { scope, tenant_id: tenantId } }),
  });
  const gatewayEnabled: boolean = (gatewayQ.data as any)?.meta_gateway_fallback_enabled ?? true;

  // Passive preflight — runs on tab mount so admins see missing/invalid Cloud
  // Secret bindings before they ever click "Test entire chain".
  const preflightQ = useQuery({
    queryKey: ["llm-preflight", scope, tenantId ?? null],
    queryFn: () => preflight({ data: { scope, tenant_id: tenantId } }),
    refetchOnWindowFocus: false,
  });
  const preflightData: any = preflightQ.data;

  // Local form state per slot, seeded from the existing provider row.
  const [forms, setForms] = useState<Record<SlotIndex, SlotForm | null>>({ 0: null, 1: null, 2: null, 3: null });
  const [tests, setTests] = useState<Record<string, { ok: boolean; latency_ms: number; error?: string } | undefined>>({});
  const [showBaseUrl, setShowBaseUrl] = useState<Record<SlotIndex, boolean>>({ 0: false, 1: false, 2: false, 3: false });
  const [chainResult, setChainResult] = useState<any | null>(null);
  const [rlDraft, setRlDraft] = useState<{
    per_user_max: string; per_user_window_seconds: string;
    per_tenant_max: string; per_tenant_window_seconds: string;
  } | null>(null);

  const bySlot = useMemo(() => {
    const map: Record<SlotIndex, any | undefined> = {} as any;
    for (const r of (providersQ.data ?? []) as any[]) {
      if (r.priority !== null && r.priority !== undefined) map[r.priority as SlotIndex] = r;
    }
    return map;
  }, [providersQ.data]);

  function getForm(slot: SlotIndex): SlotForm {
    if (forms[slot]) return forms[slot]!;
    const existing = bySlot[slot];
    if (existing) {
      const providerMeta = (PROVIDERS as any)[existing.provider] ?? PROVIDERS.custom_muse_compatible;
      const isPreset = providerMeta.models?.includes(existing.model);
      return {
        provider: existing.provider,
        base_url: existing.base_url ?? "",
        model: existing.model ?? "",
        modelMode: isPreset ? "preset" : "custom",
        api_key: "",
        is_active: !!existing.is_active,
      };
    }
    return emptySlot();
  }

  function updateForm(slot: SlotIndex, patch: Partial<SlotForm>) {
    setForms((f) => ({ ...f, [slot]: { ...getForm(slot), ...patch } }));
  }

  const mSave = useMutation({
    mutationFn: async (slot: SlotIndex) => {
      const f = getForm(slot);
      const existing = bySlot[slot];
      return upsert({
        data: {
          id: existing?.id,
          scope, tenant_id: tenantId,
          provider: f.provider,
          display_name: `${(PROVIDERS as any)[f.provider]?.label ?? f.provider} · ${SLOTS.find((s) => s.idx === slot)!.label}`,
          base_url: f.base_url || undefined,
          model: f.model,
          api_key: f.api_key || undefined,
          is_active: f.is_active,
          priority: slot,
        },
      });
    },
    onSuccess: (r: any, slot) => {
      const label = SLOTS.find((s) => s.idx === slot)!.label;
      const vs = r?.vault_status as string | undefined;
      if (vs === "created") toast.success(`Saved ${label}. Key auto-encrypted and stored in Vault (audit logged, plaintext not persisted).`);
      else if (vs === "rotated") toast.success(`Saved ${label}. Vault key rotated automatically (new version + fingerprint recorded).`);
      else if (vs === "unchanged") toast.success(`Saved ${label}. Vault key unchanged (same fingerprint).`);
      else if (vs === "error") toast.warning(`Saved ${label}, but Vault sync failed: ${r?.vault_error ?? "unknown"}. Add the key manually under Vault.`);
      else toast.success(`Saved ${label}.`);
      setForms((f) => ({ ...f, [slot]: null }));
      qc.invalidateQueries({ queryKey: ["llm", scope, tenantId ?? null] });
      qc.invalidateQueries({ queryKey: ["llm-preflight", scope, tenantId ?? null] });
      qc.invalidateQueries({ queryKey: ["vault-secrets", scope, tenantId ?? null] });
    },

    onError: (e: any) => toast.error(e?.message ?? "Save failed"),
  });

  const mDelete = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => { toast.success("Removed"); qc.invalidateQueries({ queryKey: ["llm", scope, tenantId ?? null] }); qc.invalidateQueries({ queryKey: ["llm-preflight", scope, tenantId ?? null] }); },
    onError: (e: any) => toast.error(e?.message ?? "Delete failed"),
  });

  const mTest = useMutation({
    mutationFn: async (row: any) => test1({ data: { id: row.id } }),
    onSuccess: (r: any, row) => {
      setTests((t) => ({ ...t, [row.id]: { ok: r.ok, latency_ms: r.latency_ms, error: r.error } }));
      r.ok ? toast.success(`${providerLabel(r.provider)}: OK in ${r.latency_ms} ms`) : toast.error(r.error ?? "Test failed");
    },
    onError: (e: any) => toast.error(e?.message ?? "Test failed"),
  });

  const mTestChain = useMutation({
    mutationFn: async () => {
      // Preflight: verify vault secrets exist for every active tier before we
      // burn a rate-limited chain test on a chain that can't possibly respond.
      const pf: any = await preflight({ data: { scope, tenant_id: tenantId } });
      if (!pf.ready) {
        if (pf.reason === "no_active_tiers") {
          throw new Error("No active tiers configured. Add a Primary provider and enable it.");
        }
        const names = (pf.missing ?? [])
          .map((m: any) => `#${m.priority} ${providerLabel(m.provider)} (vault: llm_api_key/${m.secret_name})`)
          .join(", ");
        throw new Error(`Preflight failed — missing vault secrets: ${names}. Add them in Vault before testing.`);
      }
      return testAll({ data: { scope, tenant_id: tenantId } });
    },
    onSuccess: (r: any) => {
      const patch: Record<string, any> = {};
      for (const res of r.results ?? []) {
        const row = bySlot[res.priority as SlotIndex];
        if (row) patch[row.id] = { ok: res.ok, latency_ms: res.latency_ms, error: res.error };
      }
      setTests((t) => ({ ...t, ...patch }));
      setChainResult(r);
      r.first_ok
        ? toast.success(`Chain OK — first responding: ${providerLabel(r.first_ok.provider)} · ${r.first_ok.model} (${r.first_ok.latency_ms} ms)`)
        : toast.error(`Chain failed — no provider responded (${r.ran} tried)`);
    },
    onError: (e: any) => toast.error(e?.message ?? "Chain test failed"),
  });


  const mAi = useMutation({
    mutationFn: (enabled: boolean) => setAi({ data: { scope, tenant_id: tenantId, enabled } }),
    onSuccess: () => { toast.success("AI setting updated"); qc.invalidateQueries({ queryKey: ["llm-ai-enabled", scope, tenantId ?? null] }); },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  const mRl = useMutation({
    mutationFn: (limits: Record<string, number | null>) =>
      setRl({ data: { scope, tenant_id: tenantId, limits: limits as any } }),
    onSuccess: () => {
      toast.success("Rate limits updated");
      setRlDraft(null);
      qc.invalidateQueries({ queryKey: ["llm-rate-limits", scope, tenantId ?? null] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  function readRl() {
    const eff = rateLimitsQ.data?.effective;
    const ovr = (rateLimitsQ.data as any)?.tenant_override;
    // For tenants we edit overrides (blank = inherit); platform edits defaults.
    const src = scope === "tenant" ? (ovr ?? {}) : (eff ?? {});
    return rlDraft ?? {
      per_user_max: src.per_user_max != null ? String(src.per_user_max) : "",
      per_user_window_seconds: src.per_user_window_seconds != null ? String(src.per_user_window_seconds) : "",
      per_tenant_max: src.per_tenant_max != null ? String(src.per_tenant_max) : "",
      per_tenant_window_seconds: src.per_tenant_window_seconds != null ? String(src.per_tenant_window_seconds) : "",
    };
  }

  function parseRlValue(v: string, allowNull: boolean): number | null | undefined {
    const t = v.trim();
    if (t === "") return allowNull ? null : undefined;
    const n = Number(t);
    if (!Number.isFinite(n) || Math.floor(n) !== n || n < 1) return undefined;
    return n;
  }



  return (
    <div className="space-y-6">
      {providersQ.isError ? (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" /> Failed to load providers: {(providersQ.error as any)?.message ?? "unknown error"}
        </div>
      ) : null}

      {/* Master AI-enabled kill switch */}
      <Card className="border-primary/30 bg-gradient-to-br from-primary/5 via-transparent to-transparent">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="h-4 w-4 text-primary" /> AI capabilities
              </CardTitle>
              <CardDescription>
                {scope === "platform"
                  ? "Master switch for the whole platform. When off, no tenant can call any LLM — Copilot and agentic features stop everywhere."
                  : "ReconIQ works fully without AI. Turn on to unlock Copilot and agentic features for this tenant."}
              </CardDescription>
            </div>
            <Switch
              checked={!!(aiEnabledQ.data as any)?.ai_enabled}
              onCheckedChange={(v) => mAi.mutate(v)}
              disabled={aiEnabledQ.isLoading || mAi.isPending}
              aria-label="AI enabled"
            />
          </div>
        </CardHeader>
        {scope === "tenant" && (aiEnabledQ.data as any)?.platform_ai_enabled === false && (
          <CardContent className="pt-0">
            <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              <AlertCircle className="h-3.5 w-3.5" />
              Platform has disabled AI globally. Local tenant setting is ignored until platform re-enables.
            </div>
          </CardContent>
        )}
      </Card>

      <div className="space-y-4">
        {SLOTS.map(({ idx, label }) => {
          const existing = bySlot[idx];
          const f = getForm(idx);
          const providerMeta = (PROVIDERS as any)[f.provider] ?? PROVIDERS.custom_muse_compatible;
          const requiresBaseUrl = !!providerMeta.requires_base_url;
          const baseUrlValid = !requiresBaseUrl || /^https?:\/\//i.test(f.base_url);
          const dirty = !!forms[idx];
          const savedTest = existing ? tests[existing.id] : undefined;

          return (
            <Card key={idx} className={idx === 0 ? "border-primary/40" : ""}>
              <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    {label}
                    {idx === 0 && <Badge>Primary</Badge>}
                    {existing && !existing.is_active && <Badge variant="outline">Off</Badge>}
                  </CardTitle>
                  {existing ? (
                    <CardDescription>
                      Current: <span className="font-mono">{providerLabel(existing.provider)} · {existing.model}</span>
                      {existing.key_last4 ? <> · key ****{existing.key_last4}</> : null}
                    </CardDescription>
                  ) : (
                    <CardDescription>Not configured</CardDescription>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {providerLabel(f.provider)}
                  </span>
                  <Switch
                    checked={f.is_active}
                    onCheckedChange={(v) => updateForm(idx, { is_active: v })}
                    aria-label="Active"
                  />
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 md:grid-cols-3">
                  <div>
                    <Label>Provider</Label>
                    <Select
                      value={f.provider}
                      onValueChange={(v) => {
                        const meta = (PROVIDERS as any)[v] ?? PROVIDERS.custom_muse_compatible;
                        updateForm(idx, { provider: v as ProviderKey, model: meta.models?.[0] ?? "", modelMode: meta.models?.length ? "preset" : "custom" });
                      }}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(PROVIDERS).map(([k, meta]) => (
                          <SelectItem key={k} value={k}>{meta.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Base URL {requiresBaseUrl ? <span className="text-destructive">*</span> : <span className="text-xs text-muted-foreground">(optional)</span>}</Label>
                    <div className="relative">
                      <Input
                        aria-label="Base URL"
                        value={f.base_url}
                        placeholder="https://api.demo-bank.example/v1"
                        onChange={(e) => updateForm(idx, { base_url: e.target.value })}
                        className="font-mono text-xs pr-9"
                        type={showBaseUrl[idx] ? "text" : "password"}
                        autoComplete="off"
                        spellCheck={false}
                      />
                      {f.base_url && (
                        <button
                          type="button"
                          onClick={() => setShowBaseUrl((s) => ({ ...s, [idx]: !s[idx] }))}
                          className="absolute right-2 top-1/2 -translate-y-1/2 rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label={showBaseUrl[idx] ? "Hide base URL" : "Show base URL"}
                          aria-pressed={!!showBaseUrl[idx]}
                        >
                          {showBaseUrl[idx] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      )}
                    </div>
                    {requiresBaseUrl && !baseUrlValid && f.base_url && (
                      <p className="mt-1 text-xs text-destructive">Must start with https:// or http://</p>
                    )}
                  </div>
                  <div>
                    <Label>Model</Label>
                    <Select
                      value={f.modelMode === "preset" ? f.model : "__custom__"}
                      onValueChange={(v) => {
                        if (v === "__custom__") updateForm(idx, { modelMode: "custom" });
                        else updateForm(idx, { modelMode: "preset", model: v });
                      }}
                    >
                      <SelectTrigger><SelectValue placeholder="Select model" /></SelectTrigger>
                      <SelectContent>
                        {providerMeta.models?.map((m: string) => (
                          <SelectItem key={m} value={m}>{m}</SelectItem>
                        ))}
                        <SelectItem value="__custom__">Custom…</SelectItem>
                      </SelectContent>
                    </Select>
                    {f.modelMode === "custom" && (
                      <Input
                        className="mt-2 font-mono text-xs"
                        value={f.model}
                        placeholder="your-model-id"
                        onChange={(e) => updateForm(idx, { model: e.target.value })}
                      />
                    )}
                  </div>
                </div>

                <div>
                  <Label className="flex items-center gap-1.5"><KeyRound className="h-3.5 w-3.5" /> API key</Label>
                  <PasswordInput
                    revealLabel="API key"
                    value={f.api_key}
                    placeholder={existing?.key_last4 ? `sk-… (leave blank to keep existing ****${existing.key_last4})` : "sk-… from your provider's dashboard"}
                    onChange={(e) => updateForm(idx, { api_key: e.target.value })}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Fingerprint + last-4 are stored in the database; the raw key lives only in Cloud Secrets under{" "}
                    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">
                      {scope === "platform" ? `LLM_PLATFORM_${f.provider.toUpperCase()}_KEY` : `LLM_TENANT_${tenantId}_${f.provider.toUpperCase()}`}
                    </code>.
                  </p>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
                  <StatusPill result={savedTest} />
                  <div className="flex gap-2">
                    {existing && (
                      <Button
                        variant="ghost" size="sm"
                        onClick={() => mDelete.mutate(existing.id)}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="mr-1 h-3.5 w-3.5" /> Remove
                      </Button>
                    )}
                    <Button
                      variant="outline" size="sm"
                      disabled={!existing || mTest.isPending}
                      onClick={() => existing && mTest.mutate(existing)}
                    >
                      {mTest.isPending && mTest.variables?.id === existing?.id ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Zap className="mr-1 h-3.5 w-3.5" />}
                      Test {label}
                    </Button>
                    <Button
                      size="sm"
                      disabled={!dirty || !baseUrlValid || !f.model.trim() || mSave.isPending}
                      onClick={() => mSave.mutate(idx)}
                    >
                      {mSave.isPending && mSave.variables === idx ? "Saving…" : (existing ? "Save changes" : "Save")}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Active chain summary */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Active fallback chain
            </CardTitle>
          </div>
          <Button variant="outline" size="sm" onClick={() => mTestChain.mutate()} disabled={mTestChain.isPending}>
            {mTestChain.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Zap className="mr-1 h-3.5 w-3.5" />}
            Test entire chain
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">

          {/* Preflight banner — flags missing vault secrets AND invalid Cloud
              Secret env-binding names before any chain test runs. */}
          {preflightQ.isSuccess && preflightData && !preflightData.ready && preflightData.reason !== "no_active_tiers" && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
              <div className="mb-1 flex items-center gap-2 font-medium text-destructive">
                <AlertCircle className="h-3.5 w-3.5" />
                Preflight found problems that will make chain tests fail:
              </div>
              <ul className="ml-5 list-disc space-y-1 text-foreground">
                {(preflightData.missing ?? []).map((m: any) => (
                  <li key={`miss-${m.priority}`}>
                    <span className="font-semibold">{SLOTS[m.priority as SlotIndex]?.label ?? `#${m.priority}`}</span>{" "}
                    <span className="text-muted-foreground">({providerLabel(m.provider)})</span> — missing vault secret{" "}
                    <span className="font-mono">llm_api_key/{m.secret_name}</span>. Add it under Vault.
                  </li>
                ))}
                {(preflightData.invalid_bindings ?? []).map((b: any) => (
                  <li key={`inv-${b.priority}`}>
                    <span className="font-semibold">{SLOTS[b.priority as SlotIndex]?.label ?? `#${b.priority}`}</span>{" "}
                    <span className="text-muted-foreground">({providerLabel(b.provider)})</span> — {b.binding_issue}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {preflightQ.isSuccess && preflightData?.ready && (
            <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2 text-xs">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              <span className="font-medium">Preflight passed:</span>
              <span>all {preflightData.tiers.length} active tier(s) have valid bindings and vault secrets.</span>
            </div>
          )}

          {chainResult && (
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              {chainResult.first_ok ? (
                <div className="flex items-center gap-2">
                  <Crown className="h-4 w-4 text-amber-500" />
                  <span className="font-semibold">Chosen tier:</span>
                  <span>{SLOTS[chainResult.first_ok.priority as SlotIndex]?.label ?? `#${chainResult.first_ok.priority}`}</span>
                  <span className="text-muted-foreground">·</span>
                  <span>{providerLabel(chainResult.first_ok.provider)}</span>
                  <span className="font-mono text-xs">{chainResult.first_ok.model}</span>
                  <Badge variant="secondary" className="ml-auto">{chainResult.first_ok.latency_ms} ms</Badge>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-destructive">
                  <XCircle className="h-4 w-4" />
                  <span className="font-semibold">No tier responded</span>
                  <span className="text-muted-foreground">— {chainResult.ran} tried{gatewayEnabled ? "" : " · managed gateway is disabled, so nothing caught the failure"}</span>
                </div>
              )}
            </div>
          )}
          {SLOTS.map(({ idx, label }) => {
            const r = bySlot[idx];
            const result = r ? tests[r.id] : undefined;
            const chainRow: any = chainResult?.results?.find((x: any) => x.priority === idx);
            const role = chainRow?.role as ("chosen" | "backup_ok" | "skipped_in_prod" | "attempted_failed" | undefined);
            // Diagnostic surface: prefer chain-run detail (has http_status + role);
            // fall back to the single-tier "test" result when the user only probed one tier.
            const diag = chainRow ?? (result ? { ok: result.ok, latency_ms: result.latency_ms, error: result.error } : null);
            const skippedReason =
              role === "skipped_in_prod"
                ? "Earlier tier already succeeded — production failover never reaches this tier."
                : role === "backup_ok" && chainResult?.first_ok && idx > chainResult.first_ok.priority
                ? "Healthy, but a higher-priority tier answered first — would not be used in prod."
                : null;
            return (
              <div key={idx} className="border-b py-2 text-sm last:border-b-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] text-muted-foreground">#{idx}</span>
                    <span className="font-semibold">{label}:</span>{" "}
                    {r ? (
                      <>
                        <span>{providerLabel(r.provider)}</span> · <span className="font-mono text-xs">{r.model}</span>
                        {!r.is_active && <Badge variant="outline" className="ml-2 text-[10px]">off</Badge>}
                        {role === "chosen" && <Badge className="ml-2 gap-1 bg-amber-500/15 text-amber-700 hover:bg-amber-500/20 dark:text-amber-400"><Crown className="h-3 w-3" /> chosen</Badge>}
                        {role === "backup_ok" && <Badge variant="outline" className="ml-2 gap-1 text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="h-3 w-3" /> healthy backup</Badge>}
                        {role === "skipped_in_prod" && <Badge variant="outline" className="ml-2 gap-1 text-muted-foreground"><MinusCircle className="h-3 w-3" /> skipped in prod</Badge>}
                        {role === "attempted_failed" && <Badge variant="outline" className="ml-2 gap-1 text-destructive"><ArrowRight className="h-3 w-3" /> tried → failing over</Badge>}
                      </>
                    ) : (
                      <span className="italic text-muted-foreground">not assigned</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusPill result={result} />
                    {r && (
                      <Button variant="ghost" size="sm" onClick={() => mTest.mutate(r)} disabled={mTest.isPending}>test</Button>
                    )}
                  </div>
                </div>
                {/* Diagnostics: precise reason per tier so admins can act without guessing */}
                {r && diag && (diag.error || diag.http_status || typeof diag.latency_ms === "number") && (
                  <div className="mt-1 ml-6 grid grid-cols-1 gap-1 rounded-md border bg-muted/30 p-2 text-[11px] md:grid-cols-4">
                    <div>
                      <span className="text-muted-foreground">Outcome: </span>
                      <span className={diag.ok ? "font-medium text-emerald-600 dark:text-emerald-400" : "font-medium text-destructive"}>
                        {diag.ok ? "success" : "failure"}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Latency: </span>
                      <span className="font-mono">{diag.latency_ms ?? 0} ms</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">HTTP: </span>
                      <span className="font-mono">{diag.http_status ?? "—"}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Role: </span>
                      <span className="font-mono">{role ?? "n/a"}</span>
                    </div>
                    {diag.error && (
                      <div className="md:col-span-4 break-words text-destructive">
                        <span className="text-muted-foreground">Reason: </span>{String(diag.error)}
                      </div>
                    )}
                    {skippedReason && (
                      <div className="md:col-span-4 text-muted-foreground">{skippedReason}</div>
                    )}
                  </div>
                )}
                {r && !diag && (
                  <div className="mt-1 ml-6 text-[11px] italic text-muted-foreground">
                    No diagnostic yet — click "test" or "Test entire chain" to probe.
                  </div>
                )}
              </div>
            );
          })}
          <p className="pt-1 text-[11px] text-muted-foreground">
            "Test entire chain" probes every configured tier so you can see health. In production ReconIQ stops at the first healthy tier — later tiers are shown as "skipped in prod". When every tier fails, the managed AI safety-net catches the request unless it has been disabled above.
          </p>
        </CardContent>
      </Card>

      {/* Configurable LLM rate limits */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Gauge className="h-4 w-4" /> LLM test-call rate limits
          </CardTitle>
          <CardDescription className="text-xs">
            Caps abuse of "Test provider" and "Test entire chain" so runaway calls can't burn LLM budget.
            Two independent buckets: <span className="font-semibold">per-user</span> and{" "}
            <span className="font-semibold">shared across the {scope === "platform" ? "platform" : "tenant"}</span>.
            {scope === "tenant" && (
              <> Leave a field blank to inherit the platform default
                (user {rateLimitsQ.data?.platform_default?.per_user_max}/{rateLimitsQ.data?.platform_default?.per_user_window_seconds}s,{" "}
                tenant {rateLimitsQ.data?.platform_default?.per_tenant_max}/{rateLimitsQ.data?.platform_default?.per_tenant_window_seconds}s).</>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {rateLimitsQ.isLoading ? (
            <div className="text-xs text-muted-foreground inline-flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="rounded-md border p-3 space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Per user</div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Max calls</Label>
                      <Input inputMode="numeric" placeholder={scope === "tenant" ? "inherit" : "20"}
                        value={readRl().per_user_max}
                        onChange={(e) => setRlDraft({ ...readRl(), per_user_max: e.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Window (seconds)</Label>
                      <Input inputMode="numeric" placeholder={scope === "tenant" ? "inherit" : "60"}
                        value={readRl().per_user_window_seconds}
                        onChange={(e) => setRlDraft({ ...readRl(), per_user_window_seconds: e.target.value })} />
                    </div>
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Effective: {rateLimitsQ.data?.effective?.per_user_max}/{rateLimitsQ.data?.effective?.per_user_window_seconds}s
                  </div>
                </div>

                <div className="rounded-md border p-3 space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Shared ({scope === "platform" ? "platform-wide" : "tenant-wide"})
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Max calls</Label>
                      <Input inputMode="numeric" placeholder={scope === "tenant" ? "inherit" : "200"}
                        value={readRl().per_tenant_max}
                        onChange={(e) => setRlDraft({ ...readRl(), per_tenant_max: e.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Window (seconds)</Label>
                      <Input inputMode="numeric" placeholder={scope === "tenant" ? "inherit" : "60"}
                        value={readRl().per_tenant_window_seconds}
                        onChange={(e) => setRlDraft({ ...readRl(), per_tenant_window_seconds: e.target.value })} />
                    </div>
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Effective: {rateLimitsQ.data?.effective?.per_tenant_max}/{rateLimitsQ.data?.effective?.per_tenant_window_seconds}s
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2">
                {rlDraft && (
                  <Button variant="ghost" size="sm" onClick={() => setRlDraft(null)} disabled={mRl.isPending}>
                    Cancel
                  </Button>
                )}
                <Button
                  size="sm"
                  disabled={mRl.isPending || !rlDraft}
                  onClick={() => {
                    const d = readRl();
                    const allowNull = scope === "tenant";
                    const build = (raw: string) => {
                      const v = parseRlValue(raw, allowNull);
                      if (v === undefined && raw.trim() !== "") throw new Error("Values must be whole numbers ≥ 1");
                      return v;
                    };
                    try {
                      const limits: Record<string, number | null> = {};
                      const u1 = build(d.per_user_max);        if (u1 !== undefined) limits.per_user_max = u1;
                      const u2 = build(d.per_user_window_seconds); if (u2 !== undefined) limits.per_user_window_seconds = u2;
                      const t1 = build(d.per_tenant_max);      if (t1 !== undefined) limits.per_tenant_max = t1;
                      const t2 = build(d.per_tenant_window_seconds); if (t2 !== undefined) limits.per_tenant_window_seconds = t2;
                      if (Object.keys(limits).length === 0) { toast.info("Nothing to save"); return; }
                      mRl.mutate(limits);
                    } catch (e: any) {
                      toast.error(e?.message ?? "Invalid input");
                    }
                  }}
                >
                  {mRl.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save rate limits"}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
