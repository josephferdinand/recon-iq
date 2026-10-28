import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, HeartPulse, History, KeyRound, Loader2, Plus, RotateCcw, RotateCw, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { notifyUserError } from "@/lib/user-feedback";
import {
  listVaultSecrets, putVaultSecret, deleteVaultSecret,
  listKmsBindings, upsertKmsBinding, deleteKmsBinding, testKmsBinding,
  getVaultAccess,
  listVaultSecretVersions, rollbackVaultSecret,
  rotateVaultSecretWithVerification,
} from "@/lib/vault.functions";
import { VaultAccessMatrix } from "@/components/vault-access-matrix";

type Scope = "platform" | "tenant";
type SecretClass = "llm_api_key" | "integration_token" | "webhook_secret" | "signing_key" | "kms_credential" | "generic";
const CLASSES: SecretClass[] = ["llm_api_key", "integration_token", "webhook_secret", "signing_key", "kms_credential", "generic"];

export function VaultTab({ scope, tenantId }: { scope: Scope; tenantId?: string }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listVaultSecrets);
  const putFn = useServerFn(putVaultSecret);
  const delFn = useServerFn(deleteVaultSecret);
  const listBindFn = useServerFn(listKmsBindings);
  const upsertBindFn = useServerFn(upsertKmsBinding);
  const delBindFn = useServerFn(deleteKmsBinding);
  const testBindFn = useServerFn(testKmsBinding);
  const rotateVerifyFn = useServerFn(rotateVaultSecretWithVerification);

  const secretsQ = useQuery({
    queryKey: ["vault-secrets", scope, tenantId ?? null],
    queryFn: () => listFn({ data: { scope, tenant_id: tenantId } }),
  });
  const bindingsQ = useQuery({
    queryKey: ["vault-bindings", scope, tenantId ?? null],
    queryFn: () => listBindFn({ data: { scope, tenant_id: tenantId } }),
  });
  const accessFn = useServerFn(getVaultAccess);
  const accessQ = useQuery({
    queryKey: ["vault-access", scope, tenantId ?? null],
    queryFn: () => accessFn({ data: { scope, tenant_id: tenantId } }),
  });
  const canManage = scope === "platform"
    ? !!accessQ.data?.viewer?.can_manage_platform_secrets
    : !!accessQ.data?.viewer?.can_manage_tenant_secrets;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["vault-secrets", scope, tenantId ?? null] });
    qc.invalidateQueries({ queryKey: ["vault-bindings", scope, tenantId ?? null] });
    qc.invalidateQueries({ queryKey: ["vault-access", scope, tenantId ?? null] });
  };

  type Verify =
    | { kind: "none" }
    | { kind: "llm_provider"; provider: string; model: string; base_url?: string | null };
  const mPut = useMutation({
    mutationFn: async (v: { secret_class: SecretClass; name: string; plaintext: string; reason?: string; verify: Verify }) => {
      if (v.verify.kind === "llm_provider") {
        return await rotateVerifyFn({ data: { scope, tenant_id: tenantId, secret_class: v.secret_class, name: v.name, plaintext: v.plaintext, reason: v.reason, verify: v.verify } });
      }
      return await putFn({ data: { scope, tenant_id: tenantId, secret_class: v.secret_class, name: v.name, plaintext: v.plaintext, reason: v.reason } });
    },
    onSuccess: (res: any) => {
      if (res && "verify" in res) {
        if (res.ok) {
          toast.success(`Verified & stored — v${res.attempted_version} (${res.verify?.latency_ms ?? 0}ms).`);
        } else if (res.rolled_back) {
          toast.error("Secret verification needs attention", { description: "The previous working version was restored. Review the provider settings and try again." });
        } else {
          toast.error("Secret verification needs attention", { description: "We could not verify or restore this secret. Avoid using it until an administrator reviews the configuration." });
        }
      } else {
        toast.success("Secret stored");
      }
      invalidate();
    },
    onError: (e: any) => notifyUserError(e, "vault secret storage"),
  });
  const mDel = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => { toast.success("Secret deleted"); invalidate(); },
    onError: (e: any) => notifyUserError(e, "vault secret removal"),
  });
  const mBind = useMutation({
    mutationFn: (v: any) => upsertBindFn({ data: { scope, tenant_id: tenantId, ...v } }),
    onSuccess: () => { toast.success("KMS binding saved"); invalidate(); },
    onError: (e: any) => notifyUserError(e, "KMS binding"),
  });
  const mDelBind = useMutation({
    mutationFn: (id: string) => delBindFn({ data: { id } }),
    onSuccess: () => { toast.success("Binding removed"); invalidate(); },
    onError: (e: any) => notifyUserError(e, "KMS binding removal"),
  });
  const mTest = useMutation({
    mutationFn: (id: string) => testBindFn({ data: { id } }),
    onSuccess: (res: any) => res.ok
      ? toast.success("KMS connection verified", { description: "This binding can encrypt and decrypt successfully." })
      : toast.error("KMS connection needs attention", { description: "The binding could not be verified. Review its configuration before using it." }),
  });

  const mHealth = useMutation({
    mutationFn: async () => {
      const bindings = (bindingsQ.data ?? []) as Array<{ id: string; provider: string; key_ref: string }>;
      if (bindings.length === 0) {
        return { total: 0, passed: 0, failed: 0, results: [] as Array<{ id: string; provider: string; ok: boolean; latency_ms: number; error: string | null }> };
      }
      const results: Array<{ id: string; provider: string; ok: boolean; latency_ms: number; error: string | null }> = [];
      for (const b of bindings) {
        try {
          const r: any = await testBindFn({ data: { id: b.id } });
          results.push({ id: b.id, provider: b.provider, ok: !!r.ok, latency_ms: r.latency_ms ?? 0, error: r.ok ? null : "Verification needs attention" });
        } catch {
          results.push({ id: b.id, provider: b.provider, ok: false, latency_ms: 0, error: "Verification needs attention" });
        }
      }
      const passed = results.filter((r) => r.ok).length;
      return { total: results.length, passed, failed: results.length - passed, results };
    },
    onSuccess: (res) => {
      invalidate();
      if (res.total === 0) {
        toast.message("No custom KMS bindings — vault uses the built-in meta_managed KEK.");
        return;
      }
      if (res.failed === 0) {
        toast.success(`KMS health check passed — ${res.passed}/${res.total} bindings encrypt/decrypt OK.`);
      } else {
        toast.error(`KMS health check: ${res.failed} of ${res.total} bindings failed. Resolve before rotating secrets.`);
      }
    },
    onError: (e: any) => notifyUserError(e, "KMS health check"),
  });

  const [open, setOpen] = useState(false);
  const [bindOpen, setBindOpen] = useState(false);
  const [historyFor, setHistoryFor] = useState<{ id: string; name: string; secret_class: string } | null>(null);

  return (
    <div className="space-y-6">
      <VaultAccessMatrix scope={scope} tenantId={tenantId} />

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2"><KeyRound className="h-4 w-4" />Vault — encrypted secrets</CardTitle>
            <CardDescription>
              Envelope-encrypted (AES-256-GCM + wrapped DEK). Values never leave the server plaintext.
              Configure a KMS binding below to use your own key (BYOK-KMS).
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => setOpen(true)} disabled={!canManage} title={canManage ? undefined : "You are not authorised to manage secrets for this scope"}><Plus className="h-4 w-4 mr-1" />Add / rotate secret</Button>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Class</th>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Fingerprint</th>
                <th className="px-4 py-2">Last 4</th>
                <th className="px-4 py-2">KEK</th>
                <th className="px-4 py-2">v</th>
                <th className="px-4 py-2">Rotated</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {(secretsQ.data ?? []).map((s: any) => (
                <tr key={s.id} className="border-b hover:bg-muted/20">
                  <td className="px-4 py-2"><Badge variant="outline">{s.secret_class}</Badge></td>
                  <td className="px-4 py-2 font-mono text-xs">{s.name}</td>
                  <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{s.fingerprint_sha256?.slice(0, 12)}…</td>
                  <td className="px-4 py-2 font-mono text-xs">••••{s.last4 ?? ""}</td>
                  <td className="px-4 py-2 text-xs">{s.kek_provider} <span className="text-muted-foreground">/ {s.kek_ref}</span></td>
                  <td className="px-4 py-2 text-xs">{s.version}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{s.rotated_at ? new Date(s.rotated_at).toLocaleString() : "—"}</td>
                  <td className="px-4 py-2 text-right space-x-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setHistoryFor({ id: s.id, name: s.name, secret_class: s.secret_class })}
                      title="View version history & roll back"
                    >
                      <History className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => mDel.mutate(s.id)} disabled={mDel.isPending || !canManage} title={canManage ? undefined : "Read-only"}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
              {secretsQ.data && secretsQ.data.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground text-sm">
                  No vault secrets yet. Click "Add / rotate secret" to store your first encrypted value.
                </td></tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" />KMS bindings (BYOK-KMS)</CardTitle>
            <CardDescription>
              Choose the Key Encryption Key (KEK) used to wrap Data Encryption Keys (DEKs).
              Default is <code>meta_managed</code>. AWS/GCP/Azure adapters require additional IAM setup.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => mHealth.mutate()}
              disabled={mHealth.isPending || bindingsQ.isLoading}
              title="Run encrypt/decrypt round-trip against every binding in this scope"
            >
              {mHealth.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <HeartPulse className="h-4 w-4 mr-1" />}
              Health check
            </Button>
            <Button size="sm" onClick={() => setBindOpen(true)} disabled={!canManage} title={canManage ? undefined : "You are not authorised to manage KMS bindings for this scope"}><Plus className="h-4 w-4 mr-1" />Add binding</Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Provider</th>
                <th className="px-4 py-2">Key ref</th>
                <th className="px-4 py-2">Region</th>
                <th className="px-4 py-2">Default</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Last verified</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {(bindingsQ.data ?? []).map((b: any) => (
                <tr key={b.id} className="border-b hover:bg-muted/20">
                  <td className="px-4 py-2"><Badge>{b.provider}</Badge></td>
                  <td className="px-4 py-2 font-mono text-xs">{b.key_ref}</td>
                  <td className="px-4 py-2 text-xs">{b.region ?? "—"}</td>
                  <td className="px-4 py-2 text-xs">{b.is_default ? "yes" : "—"}</td>
                  <td className="px-4 py-2 text-xs">{b.status}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {b.verification_needs_attention ? <span className="text-destructive inline-flex items-center gap-1"><AlertTriangle className="h-3 w-3" aria-hidden />Verification needs attention. Retry the binding test or contact support.</span> : (b.last_verified_at ? new Date(b.last_verified_at).toLocaleString() : "—")}
                  </td>
                  <td className="px-4 py-2 text-right space-x-1">
                    <Button size="sm" variant="ghost" onClick={() => mTest.mutate(b.id)} disabled={mTest.isPending} title="Test encrypt/decrypt round-trip">
                      {mTest.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => mDelBind.mutate(b.id)} disabled={mDelBind.isPending || !canManage} title={canManage ? undefined : "Read-only"}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
              {bindingsQ.data && bindingsQ.data.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground text-sm">
                  No custom KMS bindings. Vault will use the built-in <code>meta_managed</code> KEK.
                </td></tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <SecretDialog
        open={open}
        onOpenChange={setOpen}
        onSubmit={(v) => { mPut.mutate(v, { onSuccess: () => setOpen(false) }); }}
        pending={mPut.isPending}
      />
      <BindingDialog
        open={bindOpen}
        onOpenChange={setBindOpen}
        onSubmit={(v) => { mBind.mutate(v, { onSuccess: () => setBindOpen(false) }); }}
        pending={mBind.isPending}
      />
      <HistoryDialog
        target={historyFor}
        onOpenChange={(v) => { if (!v) setHistoryFor(null); }}
        canManage={canManage}
        onRollback={() => invalidate()}
      />
    </div>
  );
}

function SecretDialog({ open, onOpenChange, onSubmit, pending }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  onSubmit: (v: {
    secret_class: SecretClass;
    name: string;
    plaintext: string;
    reason?: string;
    verify: { kind: "none" } | { kind: "llm_provider"; provider: string; model: string; base_url?: string | null };
  }) => void;
  pending: boolean;
}) {
  const [secret_class, setClass] = useState<SecretClass>("llm_api_key");
  const [name, setName] = useState("");
  const [plaintext, setPlain] = useState("");
  const [reason, setReason] = useState("");
  const [verifyEnabled, setVerifyEnabled] = useState(true);
  const [verifyProvider, setVerifyProvider] = useState<string>("anthropic");
  const [verifyModel, setVerifyModel] = useState<string>("claude-3-5-haiku-20241022");
  const [verifyBaseUrl, setVerifyBaseUrl] = useState<string>("");

  const showVerify = secret_class === "llm_api_key";
  const wantsVerify = showVerify && verifyEnabled;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover">
        <DialogHeader>
          <DialogTitle>Add or rotate secret</DialogTitle>
          <DialogDescription>
            Stored envelope-encrypted. Value is never persisted or logged in plaintext.
            LLM keys can be verified against the upstream provider — if verification fails,
            the previous encrypted secret is automatically restored.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Class</Label>
            <Select value={secret_class} onValueChange={(v) => setClass(v as SecretClass)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent className="bg-popover">
                {CLASSES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="ANTHROPIC" />
            <p className="text-xs text-muted-foreground mt-1">For LLM keys use the provider name uppercased (e.g. <code>ANTHROPIC</code>, <code>MUSE</code>).</p>
          </div>
          <div>
            <Label>Value</Label>
            <Textarea value={plaintext} onChange={(e) => setPlain(e.target.value)} rows={3} placeholder="paste secret value" autoComplete="off" />
          </div>
          <div>
            <Label>Reason (optional)</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="rotation reason for audit trail" />
          </div>

          {showVerify ? (
            <div className="rounded border border-dashed p-3 space-y-3 bg-muted/20">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={verifyEnabled} onChange={(e) => setVerifyEnabled(e.target.checked)} />
                Verify upstream before commit (auto-rollback on failure)
              </label>
              {verifyEnabled ? (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Provider</Label>
                    <Select value={verifyProvider} onValueChange={setVerifyProvider}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-popover">
                        {["anthropic","muse","google","groq","perplexity","deepseek","xai","mistral","cohere","custom_muse_compatible"].map((p) => (
                          <SelectItem key={p} value={p}>{p}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Model</Label>
                    <Input value={verifyModel} onChange={(e) => setVerifyModel(e.target.value)} placeholder="claude-3-5-haiku-20241022" />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">Base URL (optional; required for custom_muse_compatible)</Label>
                    <Input value={verifyBaseUrl} onChange={(e) => setVerifyBaseUrl(e.target.value)} placeholder="https://api.example.com/v1" />
                  </div>
                  <p className="col-span-2 text-xs text-muted-foreground">
                    On failure, the previous encrypted envelope is restored as a new version. Fingerprint + last-4 stay in the audit trail.
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => onSubmit({
              secret_class, name, plaintext, reason: reason || undefined,
              verify: wantsVerify
                ? { kind: "llm_provider", provider: verifyProvider, model: verifyModel, base_url: verifyBaseUrl || null }
                : { kind: "none" },
            })}
            disabled={pending || !name || !plaintext || (wantsVerify && (!verifyProvider || !verifyModel))}
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            {wantsVerify ? "Verify & save" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BindingDialog({ open, onOpenChange, onSubmit, pending }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  onSubmit: (v: any) => void; pending: boolean;
}) {
  const [provider, setProvider] = useState<"meta_managed" | "aws_kms" | "gcp_kms" | "azure_kv">("meta_managed");
  const [key_ref, setKeyRef] = useState("APP_DATA_ENC_KEY");
  const [region, setRegion] = useState("");
  const [is_default, setDefault] = useState(true);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover">
        <DialogHeader>
          <DialogTitle>Add KMS binding</DialogTitle>
          <DialogDescription>
            The Key Encryption Key (KEK) used to wrap DEKs. Adapters other than <code>meta_managed</code>
            require the corresponding cloud IAM to be provisioned first.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Provider</Label>
            <Select value={provider} onValueChange={(v: any) => setProvider(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent className="bg-popover">
                <SelectItem value="meta_managed">meta_managed (built-in)</SelectItem>
                <SelectItem value="aws_kms">AWS KMS</SelectItem>
                <SelectItem value="gcp_kms">GCP Cloud KMS</SelectItem>
                <SelectItem value="azure_kv">Azure Key Vault</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Key ref</Label>
            <Input value={key_ref} onChange={(e) => setKeyRef(e.target.value)} placeholder="arn:aws:kms:… or projects/…/keyRings/…" />
          </div>
          <div>
            <Label>Region (optional)</Label>
            <Input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="us-east-1" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={is_default} onChange={(e) => setDefault(e.target.checked)} />
            Use as default KEK for this scope
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => onSubmit({ provider, key_ref, region: region || undefined, is_default })} disabled={pending || !key_ref}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type VersionRow = {
  id: string;
  version: number;
  change_kind: "create" | "rotate" | "rollback";
  fingerprint_sha256: string;
  last4: string | null;
  kek_provider: string;
  kek_ref: string;
  reason: string | null;
  created_at: string;
};

function HistoryDialog({
  target, onOpenChange, canManage, onRollback,
}: {
  target: { id: string; name: string; secret_class: string } | null;
  onOpenChange: (v: boolean) => void;
  canManage: boolean;
  onRollback: () => void;
}) {
  const qc = useQueryClient();
  const listVersions = useServerFn(listVaultSecretVersions);
  const rollbackFn = useServerFn(rollbackVaultSecret);
  const [reasonById, setReasonById] = useState<Record<number, string>>({});
  const [confirmVersion, setConfirmVersion] = useState<VersionRow | null>(null);

  const q = useQuery({
    queryKey: ["vault-secret-versions", target?.id ?? null],
    queryFn: () => listVersions({ data: { secret_id: target!.id } }),
    enabled: !!target,
  });

  const mRollback = useMutation({
    mutationFn: (v: { version: number; reason: string }) =>
      rollbackFn({ data: { secret_id: target!.id, target_version: v.version, reason: v.reason } }),
    onSuccess: (res: any) => {
      toast.success(`Rolled back — restored v${res.restored_from_version} as v${res.new_version}. Live secret now decrypts with the previous DEK envelope.`);
      qc.invalidateQueries({ queryKey: ["vault-secret-versions", target?.id ?? null] });
      setConfirmVersion(null);
      onRollback();
    },
    onError: (e: any) => notifyUserError(e, "vault version restore"),
  });

  const currentVersion = q.data?.current_version;
  const currentRow = (q.data?.versions ?? []).find((v: any) => v.version === currentVersion) as VersionRow | undefined;

  return (
    <Dialog open={!!target} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-4 w-4" />
            Version history — <span className="font-mono text-sm">{target?.name}</span>
          </DialogTitle>
          <DialogDescription>
            Every rotation preserves the encrypted envelope (ciphertext + wrapped DEK + KMS reference).
            Rollback restores a prior envelope as a new version — plaintext is never handled.
          </DialogDescription>
        </DialogHeader>

        {q.isLoading ? (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading history…
          </div>
        ) : (
          <div className="max-h-[60vh] overflow-auto rounded border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">v</th>
                  <th className="px-3 py-2">Change</th>
                  <th className="px-3 py-2">Fingerprint</th>
                  <th className="px-3 py-2">Last 4</th>
                  <th className="px-3 py-2">KEK</th>
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Reason</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {(q.data?.versions ?? []).map((r: any) => {
                  const isCurrent = r.version === q.data?.current_version;
                  return (
                    <tr key={r.id} className="border-b hover:bg-muted/20 align-top">
                      <td className="px-3 py-2 text-xs font-mono">{r.version}{isCurrent ? <Badge variant="outline" className="ml-2">current</Badge> : null}</td>
                      <td className="px-3 py-2 text-xs"><Badge variant={r.change_kind === "rollback" ? "secondary" : "outline"}>{r.change_kind}</Badge></td>
                      <td className="px-3 py-2 text-xs font-mono text-muted-foreground">{r.fingerprint_sha256?.slice(0, 12)}…</td>
                      <td className="px-3 py-2 text-xs font-mono">••••{r.last4 ?? ""}</td>
                      <td className="px-3 py-2 text-xs">{r.kek_provider}<div className="text-muted-foreground truncate max-w-[160px]">{r.kek_ref}</div></td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground max-w-[200px] truncate">{r.reason ?? "—"}</td>
                      <td className="px-3 py-2 text-right">
                        {isCurrent ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          <div className="flex flex-col items-end gap-1">
                            <Input
                              placeholder="Rollback reason (required)"
                              className="h-8 text-xs w-56"
                              value={reasonById[r.version] ?? ""}
                              onChange={(e) => setReasonById((m) => ({ ...m, [r.version]: e.target.value }))}
                              disabled={!canManage}
                            />
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setConfirmVersion(r)}
                              disabled={
                                !canManage ||
                                mRollback.isPending ||
                                (reasonById[r.version] ?? "").trim().length < 3
                              }
                              title={canManage ? "Restore this envelope as the new current version" : "Read-only"}
                            >
                              <RotateCcw className="h-4 w-4 mr-1" />
                              Roll back…
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {q.data && q.data.versions.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground text-sm">No version history yet.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>

        <AlertDialog open={!!confirmVersion} onOpenChange={(v) => { if (!v) setConfirmVersion(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                Confirm rollback to v{confirmVersion?.version}
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2 text-sm">
                  <p>
                    This will restore the encrypted envelope from <span className="font-mono">v{confirmVersion?.version}</span> as
                    a new current version. All downstream consumers will immediately decrypt with the previous DEK envelope.
                    The action is recorded to the audit log and rotation log.
                  </p>
                  <div className="rounded border bg-muted/40 p-2 font-mono text-xs space-y-1">
                    <div>current  v{currentVersion} · fp {currentRow?.fingerprint_sha256?.slice(0, 12)}… · ••••{currentRow?.last4 ?? ""}</div>
                    <div>restore  v{confirmVersion?.version} · fp {confirmVersion?.fingerprint_sha256?.slice(0, 12)}… · ••••{confirmVersion?.last4 ?? ""}</div>
                    <div>KEK      {confirmVersion?.kek_provider} / {confirmVersion?.kek_ref}</div>
                  </div>
                  <p className="text-muted-foreground">
                    Reason: <span className="text-foreground">{confirmVersion ? (reasonById[confirmVersion.version] ?? "") : ""}</span>
                  </p>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={mRollback.isPending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={mRollback.isPending || !canManage}
                onClick={(e) => {
                  e.preventDefault();
                  if (!confirmVersion) return;
                  mRollback.mutate({
                    version: confirmVersion.version,
                    reason: (reasonById[confirmVersion.version] ?? "").trim(),
                  });
                }}
              >
                {mRollback.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RotateCcw className="h-4 w-4 mr-1" />}
                Yes, roll back
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

      </DialogContent>
    </Dialog>
  );
}
