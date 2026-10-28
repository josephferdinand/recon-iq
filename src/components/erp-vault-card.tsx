/**
 * Credential Vault UI for ERP connectors.
 *
 * Renders per-auth-method credential entry forms (OAuth 2.0, API key, Basic,
 * Service Account, SSH key), sends them to `saveErpVaultSecret`, and lets an
 * admin test / rotate / delete each stored secret. Plaintext never leaves the
 * form: on submit it's posted to the server function which envelope-encrypts
 * into `app_vault_secrets`. The UI only ever receives metadata (name, last4,
 * fingerprint, version, timestamps).
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Vault,
  KeyRound,
  ShieldCheck,
  RefreshCw,
  Trash2,
  PlayCircle,
  Loader2,
  CheckCircle2,
  XCircle,
  Link2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/password-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  listErpVaultSecrets,
  saveErpVaultSecret,
  deleteErpVaultSecret,
  testErpVaultCredential,
} from "@/lib/erp-vault.functions";

type AuthKind = "oauth2" | "api_key" | "basic" | "service_account" | "ssh_key";

type SecretRow = {
  id: string;
  name: string;
  secret_class: string;
  last4: string | null;
  fingerprint_sha256: string;
  version: number;
  created_at: string;
  rotated_at: string | null;
  kek_provider: string;
};

type CredentialFormState = {
  kind: AuthKind;
  // oauth2
  client_id: string;
  client_secret: string;
  token_url: string;
  scopes: string;
  // api_key
  header_name: string;
  header_prefix: string;
  api_key: string;
  // basic
  username: string;
  password: string;
  // service_account
  sa_json: string;
  sa_token_url: string;
  // ssh_key
  ssh_username: string;
  private_key: string;
  passphrase: string;
};

const EMPTY_FORM: CredentialFormState = {
  kind: "oauth2",
  client_id: "", client_secret: "", token_url: "", scopes: "",
  header_name: "Authorization", header_prefix: "Bearer", api_key: "",
  username: "", password: "",
  sa_json: "", sa_token_url: "",
  ssh_username: "", private_key: "", passphrase: "",
};

function buildCredentialPayload(f: CredentialFormState): Record<string, unknown> | null {
  switch (f.kind) {
    case "oauth2":
      if (!f.client_id || !f.client_secret || !f.token_url) return null;
      return {
        kind: "oauth2",
        grant_type: "client_credentials",
        client_id: f.client_id,
        client_secret: f.client_secret,
        token_url: f.token_url,
        scopes: f.scopes.split(",").map((s) => s.trim()).filter(Boolean),
      };
    case "api_key":
      if (!f.api_key) return null;
      return {
        kind: "api_key",
        header_name: f.header_name || "Authorization",
        header_prefix: f.header_prefix,
        api_key: f.api_key,
      };
    case "basic":
      if (!f.username || !f.password) return null;
      return { kind: "basic", username: f.username, password: f.password };
    case "service_account":
      if (!f.sa_json) return null;
      return {
        kind: "service_account",
        json: f.sa_json,
        ...(f.sa_token_url ? { token_url: f.sa_token_url } : {}),
        scopes: [],
      };
    case "ssh_key":
      if (!f.private_key) return null;
      return {
        kind: "ssh_key",
        ...(f.ssh_username ? { username: f.ssh_username } : {}),
        private_key: f.private_key,
        ...(f.passphrase ? { passphrase: f.passphrase } : {}),
      };
  }
}

export function ErpVaultCard({
  tenantId,
  selectedSecretId,
  suggestedBaseUrl,
  onAttach,
}: {
  tenantId: string | null;
  selectedSecretId?: string | null;
  suggestedBaseUrl?: string | null;
  onAttach?: (secret: SecretRow) => void;
}) {
  const qc = useQueryClient();
  const listFn = useServerFn(listErpVaultSecrets);
  const saveFn = useServerFn(saveErpVaultSecret);
  const delFn = useServerFn(deleteErpVaultSecret);
  const testFn = useServerFn(testErpVaultCredential);

  const list = useQuery({
    queryKey: ["erp-vault", tenantId],
    queryFn: () => listFn({ data: { tenant_id: tenantId! } }),
    enabled: !!tenantId,
  });

  const [open, setOpen] = useState(false);
  const [rotateFor, setRotateFor] = useState<SecretRow | null>(null);
  const [name, setName] = useState("");
  const [form, setForm] = useState<CredentialFormState>(EMPTY_FORM);
  const resetForm = () => { setForm(EMPTY_FORM); setName(""); };

  const saveMut = useMutation({
    mutationFn: async () => {
      const credential = buildCredentialPayload(form);
      if (!credential) throw new Error("Fill every required field for this auth method.");
      return saveFn({
        data: {
          tenant_id: tenantId!,
          name: (rotateFor?.name ?? name).trim(),
          credential: credential as never,
          ...(rotateFor ? { rotate_existing_id: rotateFor.id, reason: "manual rotation from vault UI" } : {}),
        },
      });
    },
    onSuccess: (res) => {
      toast.success(rotateFor ? `Rotated · v${res.version} · …${res.last4}` : `Saved · …${res.last4}`);
      qc.invalidateQueries({ queryKey: ["erp-vault", tenantId] });
      setOpen(false); setRotateFor(null); resetForm();
    },
    onError: (e: any) => toast.error(e?.message ?? "Save failed"),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => delFn({ data: { tenant_id: tenantId!, secret_id: id } }),
    onSuccess: () => {
      toast.success("Secret deleted.");
      qc.invalidateQueries({ queryKey: ["erp-vault", tenantId] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Delete failed"),
  });

  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; ok: boolean; message: string; http_status?: number; latency_ms?: number; stage: string } | null>(null);
  const testMut = useMutation({
    mutationFn: (secret_id: string) => {
      setTestingId(secret_id);
      return testFn({
        data: {
          tenant_id: tenantId!,
          secret_id,
          ...(suggestedBaseUrl ? { base_url: suggestedBaseUrl } : {}),
        },
      });
    },
    onSuccess: (res, id) => {
      setTestingId(null);
      setTestResult({ id, ...res });
      toast[res.ok ? "success" : "error"](res.message, {
        description: `stage=${res.stage}${res.http_status ? " · HTTP " + res.http_status : ""} · ${res.latency_ms ?? "?"}ms`,
      });
    },
    onError: (e: any) => { setTestingId(null); toast.error(e?.message ?? "Test failed"); },
  });

  const rows: SecretRow[] = useMemo(() => (list.data?.secrets ?? []) as SecretRow[], [list.data]);

  return (
    <Card className="border-primary/20">
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <Vault className="h-5 w-5 text-primary" aria-hidden />
            Credential vault
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Envelope-encrypted (AES-256-GCM) — DEK wrapped by tenant KEK. Plaintext is never returned.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => list.refetch()} disabled={!tenantId}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> Refresh
          </Button>
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setRotateFor(null); resetForm(); } }}>
            <DialogTrigger asChild>
              <Button size="sm" disabled={!tenantId} className="gap-1">
                <KeyRound className="h-3.5 w-3.5" /> Add credential
              </Button>
            </DialogTrigger>
            <CredentialDialog
              rotateFor={rotateFor}
              name={name} setName={setName}
              form={form} setForm={setForm}
              onSubmit={() => saveMut.mutate()}
              pending={saveMut.isPending}
            />
          </Dialog>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {!tenantId ? (
          <p className="text-sm text-muted-foreground">Resolving tenant…</p>
        ) : list.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading vault…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No credentials yet. Click <strong>Add credential</strong> to store OAuth, API key, basic,
            service-account, or SSH-key material for your ERP connectors.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Last 4</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>KEK</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Rotated</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((s) => {
                const active = selectedSecretId === s.id;
                const tr = testResult?.id === s.id ? testResult : null;
                return (
                  <TableRow key={s.id} className={active ? "bg-primary/5" : ""}>
                    <TableCell className="font-mono text-xs">
                      <div className="flex items-center gap-2">
                        {active ? <ShieldCheck className="h-3.5 w-3.5 text-primary" aria-label="Attached" /> : null}
                        {s.name}
                      </div>
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        fp: {s.fingerprint_sha256.slice(0, 12)}…
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">…{s.last4 ?? "----"}</TableCell>
                    <TableCell><Badge variant="outline">v{s.version}</Badge></TableCell>
                    <TableCell className="text-xs">{s.kek_provider}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(s.created_at).toLocaleString()}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {s.rotated_at ? new Date(s.rotated_at).toLocaleString() : "—"}
                    </TableCell>
                    <TableCell className="flex justify-end gap-1">
                      {onAttach ? (
                        <Button size="sm" variant={active ? "secondary" : "outline"} className="gap-1"
                          onClick={() => onAttach(s)}>
                          <Link2 className="h-3 w-3" /> {active ? "Attached" : "Attach"}
                        </Button>
                      ) : null}
                      <Button size="sm" variant="outline" className="gap-1"
                        disabled={testingId === s.id}
                        onClick={() => testMut.mutate(s.id)}>
                        {testingId === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> :
                          tr ? (tr.ok ? <CheckCircle2 className="h-3 w-3 text-emerald-500" /> : <XCircle className="h-3 w-3 text-destructive" />)
                            : <PlayCircle className="h-3 w-3" />}
                        Test
                      </Button>
                      <Button size="sm" variant="ghost"
                        onClick={() => { setRotateFor(s); resetForm(); setOpen(true); }}>
                        <RefreshCw className="h-3 w-3" /> Rotate
                      </Button>
                      <Button size="sm" variant="ghost" className="text-destructive"
                        onClick={() => { if (confirm(`Delete ${s.name}? Connectors using it will be detached.`)) delMut.mutate(s.id); }}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function CredentialDialog({
  rotateFor, name, setName, form, setForm, onSubmit, pending,
}: {
  rotateFor: SecretRow | null;
  name: string; setName: (v: string) => void;
  form: CredentialFormState; setForm: (v: CredentialFormState) => void;
  onSubmit: () => void;
  pending: boolean;
}) {
  return (
    <DialogContent className="max-w-2xl bg-popover">
      <DialogHeader>
        <DialogTitle>{rotateFor ? `Rotate: ${rotateFor.name}` : "Add credential to vault"}</DialogTitle>
        <DialogDescription>
          Enter the secret material once; the server encrypts it (AES-256-GCM) before it lands in
          the vault. This form is the only place raw material is ever accepted.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        {!rotateFor ? (
          <div className="grid gap-2">
            <Label htmlFor="vault-name">Secret name</Label>
            <Input id="vault-name" placeholder="sap-prod-oauth"
              value={name} onChange={(e) => setName(e.target.value)} />
            <p className="text-[11px] text-muted-foreground">
              Lowercase, digits, <code>. _ -</code>. Referenced as
              <code className="mx-1">credential_vault_secret_id</code> by ERP connectors.
            </p>
          </div>
        ) : (
          <div className="rounded-md border border-border/60 bg-muted/40 p-3 text-xs">
            Rotating <strong>{rotateFor.name}</strong> · current version <strong>v{rotateFor.version}</strong>.
            The new payload becomes v{rotateFor.version + 1}; the prior version is retained in
            <code className="mx-1">app_vault_secret_versions</code> for audit / restore.
          </div>
        )}

        <Tabs value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v as AuthKind })}>
          <TabsList className="grid grid-cols-5 w-full">
            <TabsTrigger value="oauth2">OAuth 2.0</TabsTrigger>
            <TabsTrigger value="api_key">API Key</TabsTrigger>
            <TabsTrigger value="basic">Basic</TabsTrigger>
            <TabsTrigger value="service_account">Svc Acct</TabsTrigger>
            <TabsTrigger value="ssh_key">SSH Key</TabsTrigger>
          </TabsList>

          <TabsContent value="oauth2" className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="grid gap-1">
              <Label>Client ID</Label>
              <Input value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })} />
            </div>
            <div className="grid gap-1">
              <Label>Client secret</Label>
              <PasswordInput revealLabel="client secret" value={form.client_secret}
                onChange={(e) => setForm({ ...form, client_secret: e.target.value })} />
            </div>
            <div className="md:col-span-2 grid gap-1">
              <Label>Token URL</Label>
              <Input placeholder="https://.../oauth2/token"
                value={form.token_url} onChange={(e) => setForm({ ...form, token_url: e.target.value })} />
            </div>
            <div className="md:col-span-2 grid gap-1">
              <Label>Scopes (comma-separated)</Label>
              <Input value={form.scopes} onChange={(e) => setForm({ ...form, scopes: e.target.value })} />
            </div>
          </TabsContent>

          <TabsContent value="api_key" className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="grid gap-1">
              <Label>Header name</Label>
              <Input value={form.header_name} onChange={(e) => setForm({ ...form, header_name: e.target.value })} />
            </div>
            <div className="grid gap-1">
              <Label>Header prefix</Label>
              <Input placeholder="Bearer / ApiKey / (blank)" value={form.header_prefix}
                onChange={(e) => setForm({ ...form, header_prefix: e.target.value })} />
            </div>
            <div className="md:col-span-2 grid gap-1">
              <Label>API key</Label>
              <PasswordInput revealLabel="API key" value={form.api_key}
                onChange={(e) => setForm({ ...form, api_key: e.target.value })} />
            </div>
          </TabsContent>

          <TabsContent value="basic" className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="grid gap-1">
              <Label>Username</Label>
              <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            </div>
            <div className="grid gap-1">
              <Label>Password</Label>
              <PasswordInput revealLabel="password" value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </div>
          </TabsContent>

          <TabsContent value="service_account" className="mt-4 grid gap-3">
            <div className="grid gap-1">
              <Label>Token URL (optional)</Label>
              <Input value={form.sa_token_url}
                onChange={(e) => setForm({ ...form, sa_token_url: e.target.value })} />
            </div>
            <div className="grid gap-1">
              <Label>Service account JSON</Label>
              <Textarea rows={8} className="font-mono text-xs"
                placeholder='{"type":"service_account","private_key":"EXAMPLE_PRIVATE_KEY"}'
                value={form.sa_json} onChange={(e) => setForm({ ...form, sa_json: e.target.value })} />
            </div>
          </TabsContent>

          <TabsContent value="ssh_key" className="mt-4 grid gap-3">
            <div className="grid gap-1">
              <Label>SSH username (optional)</Label>
              <Input value={form.ssh_username}
                onChange={(e) => setForm({ ...form, ssh_username: e.target.value })} />
            </div>
            <div className="grid gap-1">
              <Label>Private key (PEM)</Label>
              <Textarea rows={8} className="font-mono text-xs"
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                value={form.private_key}
                onChange={(e) => setForm({ ...form, private_key: e.target.value })} />
            </div>
            <div className="grid gap-1">
              <Label>Passphrase (optional)</Label>
              <PasswordInput revealLabel="passphrase" value={form.passphrase}
                onChange={(e) => setForm({ ...form, passphrase: e.target.value })} />
            </div>
          </TabsContent>
        </Tabs>

        <p className="text-xs text-muted-foreground">Encrypted at rest — plaintext never persisted.</p>
      </div>

      <DialogFooter>
        <Button onClick={onSubmit} disabled={pending || (!rotateFor && !name.trim())} className="gap-1">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
          {rotateFor ? "Rotate" : "Encrypt & save"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
