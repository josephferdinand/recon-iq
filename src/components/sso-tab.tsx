import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listSsoConfigs, upsertSsoConfig, deleteSsoConfig, testSsoConfig,
  setSsoEnabled, importSamlMetadata, rotateSsoCertificate,
  rollbackSsoCertificate, listSsoCertHistory, importOidcDiscovery,
} from "@/lib/sso.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/password-input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertCircle, CheckCircle2, Copy, FileUp, History, KeyRound, Plus,
  RefreshCw, RotateCcw, ShieldAlert, Trash2, Upload,
} from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/confirm-dialog";

type SsoRow = {
  id: string;
  tenant_id: string;
  provider_type: "saml" | "oidc";
  display_name: string;
  metadata_url: string | null;
  metadata_xml: string | null;
  metadata_source: "url" | "xml" | null;
  metadata_fetched_at: string | null;
  entity_id: string | null;
  acs_url: string | null;
  client_id: string | null;
  issuer_url: string | null;
  email_domains: string[];
  enabled: boolean;
  jit_provisioning: boolean;
  default_role: string | null;
  last_tested_at: string | null;
  last_status: string | null;
  signing_cert: string | null;
  signing_cert_fingerprint: string | null;
  signing_cert_not_before: string | null;
  signing_cert_not_after: string | null;
  previous_signing_cert: string | null;
  previous_signing_cert_fingerprint: string | null;
  cert_rotated_at: string | null;
  // OIDC fields
  discovery_url: string | null;
  authorization_endpoint: string | null;
  token_endpoint: string | null;
  userinfo_endpoint: string | null;
  jwks_uri: string | null;
  end_session_endpoint: string | null;
  discovery_fetched_at: string | null;
  scopes: string[];
  redirect_uris: string[];
  response_type: "code" | "code id_token" | "id_token" | null;
  pkce_enabled: boolean;
  client_secret_last4: string | null;
};

const copyText = (v: string, msg = "Copied") => {
  navigator.clipboard.writeText(v).then(() => toast.success(msg));
};

function certExpiryBadge(notAfter: string | null) {
  if (!notAfter) return null;
  const days = Math.round((new Date(notAfter).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return <Badge variant="destructive">Expired {Math.abs(days)}d ago</Badge>;
  if (days < 30) return <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">Expires in {days}d</Badge>;
  if (days < 90) return <Badge variant="secondary">Expires in {days}d</Badge>;
  return <Badge variant="outline">Valid {days}d</Badge>;
}

export function SsoTab({ tenantId, canWrite }: { tenantId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const list = useServerFn(listSsoConfigs);
  const upsert = useServerFn(upsertSsoConfig);
  const del = useServerFn(deleteSsoConfig);
  const test = useServerFn(testSsoConfig);
  const setEnabled = useServerFn(setSsoEnabled);
  const { confirm, ConfirmDialog } = useConfirm();

  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<SsoRow> | null>(null);
  const [metaTarget, setMetaTarget] = useState<SsoRow | null>(null);
  const [certTarget, setCertTarget] = useState<SsoRow | null>(null);
  const [historyTarget, setHistoryTarget] = useState<SsoRow | null>(null);

  const q = useQuery({
    queryKey: ["sso", tenantId],
    queryFn: () => list({ data: { tenant_id: tenantId } }) as Promise<SsoRow[]>,
  });

  const save = useMutation({
    mutationFn: (v: any) => upsert({ data: v }),
    onSuccess: () => {
      toast.success("Saved");
      qc.invalidateQueries({ queryKey: ["sso", tenantId] });
      setEditOpen(false); setEditing(null);
    },
    onError: (e: any) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => del({ data: { id, tenant_id: tenantId } }),
    onSuccess: () => { toast.success("Deleted"); qc.invalidateQueries({ queryKey: ["sso", tenantId] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const verify = useMutation({
    mutationFn: (id: string) => test({ data: { id, tenant_id: tenantId } }),
    onSuccess: (r) => {
      if (r.status === "ok") toast.success("Verified");
      else if (r.status === "warn") toast.warning(r.detail);
      else toast.error(r.detail);
      qc.invalidateQueries({ queryKey: ["sso", tenantId] });
    },
    onError: (e: any) => toast.error(e.message),
  });
  const toggle = useMutation({
    mutationFn: (v: { id: string; enabled: boolean }) => setEnabled({ data: { ...v, tenant_id: tenantId } }),
    onSuccess: (_r, v) => {
      toast.success(`IdP ${v.enabled ? "enabled" : "disabled"}`);
      qc.invalidateQueries({ queryKey: ["sso", tenantId] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="h-4 w-4" /> Enterprise SSO — SAML 2.0 &amp; OIDC
            </CardTitle>
            <CardDescription>
              Federate sign-in with Okta, Ping, ADFS, Azure Entra, JumpCloud, or any SAML/OIDC IdP.
              Upload metadata, rotate signing certificates, and route by email domain — all per tenant.
            </CardDescription>
          </div>
          {canWrite && (
            <Button size="sm" onClick={() => {
              setEditing({
                provider_type: "saml",
                email_domains: [],
                enabled: false,
                scopes: ["openid", "profile", "email"],
                redirect_uris: [],
                response_type: "code",
                pkce_enabled: true,
              });
              setEditOpen(true);
            }}>
              <Plus className="mr-1 h-4 w-4" /> Add IdP
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {q.isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
          {q.isError && (
            <div className="rounded-md border border-destructive/20 bg-destructive/5 p-6 text-center">
              <div className="text-sm font-medium text-destructive">Failed to load SSO configuration</div>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => q.refetch()}>Retry</Button>
            </div>
          )}
          {!q.isLoading && (q.data ?? []).length === 0 && (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              No identity providers configured yet.
            </div>
          )}
          {(q.data ?? []).map((c) => (
            <div key={c.id} className="space-y-3 rounded-lg border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{c.display_name}</span>
                    <Badge variant="outline" className="uppercase text-[10px]">{c.provider_type}</Badge>
                    {certExpiryBadge(c.signing_cert_not_after)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {(c.email_domains ?? []).join(", ") || "no domains bound"}
                  </div>
                  {c.entity_id && (
                    <div className="truncate text-xs text-muted-foreground">
                      EntityID: <code className="rounded bg-muted px-1">{c.entity_id}</code>
                    </div>
                  )}
                  {c.signing_cert_fingerprint && (
                    <div className="flex items-center gap-1 text-[11px] font-mono text-muted-foreground">
                      SHA-256 {c.signing_cert_fingerprint.slice(0, 32)}…
                      <Button size="icon" variant="ghost" className="h-5 w-5"
                        onClick={() => copyText(c.signing_cert_fingerprint!, "Fingerprint copied")}>
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                  {c.last_status && (
                    <div className="flex items-center gap-1 text-xs">
                      {c.last_status === "verified"
                        ? <><CheckCircle2 className="h-3 w-3 text-emerald-600" /> Verified {c.last_tested_at && new Date(c.last_tested_at).toLocaleString()}</>
                        : <><AlertCircle className="h-3 w-3 text-destructive" /> {c.last_status}</>}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-2 rounded-md border px-2 py-1">
                    <span className="text-xs text-muted-foreground">{c.enabled ? "Enabled" : "Disabled"}</span>
                    <Switch
                      aria-label={`Toggle ${c.display_name}`}
                      checked={c.enabled}
                      disabled={!canWrite || toggle.isPending}
                      onCheckedChange={(v) => toggle.mutate({ id: c.id, enabled: v })}
                    />
                  </div>
                  <Button size="sm" variant="outline" onClick={() => verify.mutate(c.id)} disabled={verify.isPending}>
                    <RefreshCw className={`mr-1 h-3.5 w-3.5 ${verify.isPending ? "animate-spin" : ""}`} /> Test
                  </Button>
                  {canWrite && c.provider_type === "saml" && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => setMetaTarget(c)}>
                        <FileUp className="mr-1 h-3.5 w-3.5" /> Metadata
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setCertTarget(c)}>
                        <ShieldAlert className="mr-1 h-3.5 w-3.5" /> Rotate cert
                      </Button>
                    </>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setHistoryTarget(c)}>
                    <History className="h-4 w-4" />
                  </Button>
                  {canWrite && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => { setEditing(c); setEditOpen(true); }}>Edit</Button>
                      <Button size="sm" variant="ghost" aria-label="Delete"
                        onClick={() => confirm({
                          title: "Delete IdP?",
                          description: `Users authenticating via ${c.display_name} will lose access immediately.`,
                        }).then((ok) => ok && remove.mutate(c.id))}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <SsoEditDialog
        open={editOpen}
        onOpenChange={(v) => { setEditOpen(v); if (!v) setEditing(null); }}
        editing={editing}
        onEdit={setEditing}
        saving={save.isPending}
        onSave={() => save.mutate({ ...editing, tenant_id: tenantId })}
      />

      {metaTarget && (
        <SsoMetadataDialog
          config={metaTarget}
          onOpenChange={(v) => { if (!v) setMetaTarget(null); }}
        />
      )}
      {certTarget && (
        <SsoCertRotateDialog
          config={certTarget}
          onOpenChange={(v) => { if (!v) setCertTarget(null); }}
        />
      )}
      {historyTarget && (
        <SsoCertHistoryDialog
          config={historyTarget}
          onOpenChange={(v) => { if (!v) setHistoryTarget(null); }}
        />
      )}
      {ConfirmDialog}
    </div>
  );
}

/* ---------- Edit / create dialog ---------- */

function SsoEditDialog(props: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: Partial<SsoRow> | null;
  onEdit: (v: Partial<SsoRow> | null) => void;
  saving: boolean;
  onSave: () => void;
}) {
  const { open, onOpenChange, editing, onEdit, saving, onSave } = props;
  if (!editing) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing.id ? "Edit" : "Add"} identity provider</DialogTitle>
          <DialogDescription>
            Give this IdP a memorable name and bind the email domains that should be routed here.
            SAML metadata + certificate rotation are handled from the dedicated buttons on the card.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Type</Label>
            <Select value={editing.provider_type ?? "saml"} onValueChange={(v) => onEdit({ ...editing, provider_type: v as "saml" | "oidc" })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="saml">SAML 2.0</SelectItem>
                <SelectItem value="oidc">OIDC</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Display name</Label>
            <Input value={editing.display_name ?? ""} onChange={(e) => onEdit({ ...editing, display_name: e.target.value })} placeholder="Okta — Demo Bank" />
          </div>
        </div>
        {editing.provider_type === "saml" ? (
          <div className="space-y-3">
            <div className="space-y-1"><Label>SAML metadata URL <span className="text-xs text-muted-foreground">(optional if XML uploaded)</span></Label>
              <Input value={editing.metadata_url ?? ""} onChange={(e) => onEdit({ ...editing, metadata_url: e.target.value })} placeholder="https://idp.demo-bank.example/metadata" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Entity ID</Label>
                <Input value={editing.entity_id ?? ""} onChange={(e) => onEdit({ ...editing, entity_id: e.target.value })} placeholder="Auto-filled from metadata" />
              </div>
              <div className="space-y-1"><Label>ACS URL</Label>
                <Input value={editing.acs_url ?? ""} onChange={(e) => onEdit({ ...editing, acs_url: e.target.value })} placeholder="Auto-filled from metadata" />
              </div>
            </div>
          </div>
        ) : (
          <OidcFormSection editing={editing} onEdit={onEdit} />
        )}
        <div className="space-y-1"><Label>Email domains (comma separated)</Label>
          <Input
            value={(editing.email_domains ?? []).join(", ")}
            onChange={(e) => onEdit({
              ...editing,
              email_domains: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
            })}
            placeholder="demo-bank.example, eu.demo-bank.example"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center justify-between rounded-md border p-3">
            <div className="text-sm">Just-in-time provisioning</div>
            <Switch checked={!!editing.jit_provisioning}
              onCheckedChange={(v) => onEdit({ ...editing, jit_provisioning: v })} />
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div className="text-sm">Enabled</div>
            <Switch checked={!!editing.enabled}
              onCheckedChange={(v) => onEdit({ ...editing, enabled: v })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={onSave} disabled={saving}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Metadata import dialog ---------- */

function SsoMetadataDialog({ config, onOpenChange }: {
  config: SsoRow;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const importFn = useServerFn(importSamlMetadata);
  const [tab, setTab] = useState<"url" | "xml">(config.metadata_source ?? "url");
  const [url, setUrl] = useState(config.metadata_url ?? "");
  const [xml, setXml] = useState(config.metadata_xml ?? "");

  const doImport = useMutation({
    mutationFn: () => importFn({
      data: {
        id: config.id, tenant_id: config.tenant_id, source: tab,
        metadata_url: tab === "url" ? url : null,
        metadata_xml: tab === "xml" ? xml : null,
      },
    }),
    onSuccess: (r) => {
      toast.success(r.rotated
        ? `Metadata imported — signing certificate rotated (${r.parsed.signing_cert_fingerprint?.slice(0, 24)}…)`
        : "Metadata imported — signing certificate unchanged");
      qc.invalidateQueries({ queryKey: ["sso", config.tenant_id] });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileUp className="h-5 w-5" /> Import SAML metadata — {config.display_name}
          </DialogTitle>
          <DialogDescription>
            Upload the IdP's SAML 2.0 metadata by URL or by pasting the XML. EntityID, ACS URL,
            and the signing certificate are extracted automatically. If the certificate has
            changed, the previous one is kept for one-click rollback.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "url" | "xml")}>
          <TabsList>
            <TabsTrigger value="url">By URL</TabsTrigger>
            <TabsTrigger value="xml">Paste XML</TabsTrigger>
          </TabsList>
          <TabsContent value="url" className="mt-3 space-y-2">
            <Label>SAML metadata URL</Label>
            <Input value={url} onChange={(e) => setUrl(e.target.value)}
              placeholder="https://idp.demo-bank.example/app/saml/metadata" />
            <p className="text-xs text-muted-foreground">
              We fetch this from the platform edge. IdPs often expose it at{" "}
              <code>/metadata</code> (Okta), <code>/FederationMetadata/2007-06/FederationMetadata.xml</code> (ADFS),
              or the Azure Entra <em>Federation Metadata Document</em>.
            </p>
          </TabsContent>
          <TabsContent value="xml" className="mt-3 space-y-2">
            <Label>Paste EntityDescriptor XML</Label>
            <Textarea rows={12} spellCheck={false} className="font-mono text-xs"
              value={xml} onChange={(e) => setXml(e.target.value)}
              placeholder="<md:EntityDescriptor xmlns:md=&quot;urn:oasis:names:tc:SAML:2.0:metadata&quot; entityID=&quot;...&quot;>...</md:EntityDescriptor>" />
            <p className="text-xs text-muted-foreground">
              Air-gapped IdPs (some ADFS deployments) publish metadata as a downloadable file — paste its contents here.
            </p>
          </TabsContent>
        </Tabs>

        {config.signing_cert_fingerprint && (
          <Alert className="mt-2">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle className="text-xs">Current signing certificate</AlertTitle>
            <AlertDescription className="text-xs font-mono">
              {config.signing_cert_fingerprint}
              {config.signing_cert_not_after && (
                <span className="ml-2 text-muted-foreground">
                  valid until {new Date(config.signing_cert_not_after).toLocaleDateString()}
                </span>
              )}
            </AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => doImport.mutate()} disabled={doImport.isPending || (tab === "url" ? !url : !xml)}>
            <Upload className="mr-1 h-4 w-4" /> Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Certificate rotation dialog ---------- */

function SsoCertRotateDialog({ config, onOpenChange }: {
  config: SsoRow;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const rotate = useServerFn(rotateSsoCertificate);
  const rollback = useServerFn(rollbackSsoCertificate);
  const [cert, setCert] = useState("");
  const [note, setNote] = useState("");

  const doRotate = useMutation({
    mutationFn: () => rotate({
      data: { id: config.id, tenant_id: config.tenant_id, cert_pem: cert, note: note || null },
    }),
    onSuccess: (r) => {
      toast.success(`Certificate rotated — fingerprint ${r.fingerprint.slice(0, 24)}…`);
      qc.invalidateQueries({ queryKey: ["sso", config.tenant_id] });
      qc.invalidateQueries({ queryKey: ["sso-cert-history", config.id] });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const doRollback = useMutation({
    mutationFn: () => rollback({ data: { id: config.id, tenant_id: config.tenant_id } }),
    onSuccess: (r) => {
      toast.success(`Rolled back — active fingerprint ${(r.fingerprint ?? "").slice(0, 24)}…`);
      qc.invalidateQueries({ queryKey: ["sso", config.tenant_id] });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-amber-500" /> Rotate signing certificate — {config.display_name}
          </DialogTitle>
          <DialogDescription>
            Paste the new IdP signing certificate in PEM or base64 form. The previous certificate
            is retained so you can roll back with one click if the IdP still signs assertions with it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {config.signing_cert_fingerprint ? (
            <div className="rounded-lg border p-3 text-xs">
              <div className="font-medium">Active certificate</div>
              <div className="mt-1 font-mono">{config.signing_cert_fingerprint}</div>
              {config.signing_cert_not_after && (
                <div className="mt-1 text-muted-foreground">
                  Valid until {new Date(config.signing_cert_not_after).toLocaleString()}
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
              No certificate has been imported yet.
            </div>
          )}

          {config.previous_signing_cert_fingerprint && (
            <div className="rounded-lg border p-3 text-xs">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">Previous certificate (available for rollback)</div>
                  <div className="mt-1 font-mono">{config.previous_signing_cert_fingerprint}</div>
                </div>
                <Button size="sm" variant="outline" onClick={() => doRollback.mutate()}
                  disabled={doRollback.isPending}>
                  <RotateCcw className="mr-1 h-3.5 w-3.5" /> Roll back
                </Button>
              </div>
            </div>
          )}

          <div className="space-y-1">
            <Label>New certificate (PEM or base64)</Label>
            <Textarea rows={9} spellCheck={false} className="font-mono text-xs"
              value={cert} onChange={(e) => setCert(e.target.value)}
              placeholder={"-----BEGIN CERTIFICATE-----\nMIIC…\n-----END CERTIFICATE-----"} />
          </div>
          <div className="space-y-1">
            <Label>Note <span className="text-xs text-muted-foreground">(optional, appears in history)</span></Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="Okta scheduled rotation — ticket INC-4821" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => doRotate.mutate()} disabled={doRotate.isPending || cert.length < 40}>
            Rotate certificate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Certificate history dialog ---------- */

function SsoCertHistoryDialog({ config, onOpenChange }: {
  config: SsoRow;
  onOpenChange: (v: boolean) => void;
}) {
  const listFn = useServerFn(listSsoCertHistory);
  const q = useQuery({
    queryKey: ["sso-cert-history", config.id],
    queryFn: () => listFn({ data: { sso_config_id: config.id, tenant_id: config.tenant_id } }),
  });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5" /> Certificate rotation history — {config.display_name}
          </DialogTitle>
          <DialogDescription>
            Every signing-certificate rotation is recorded here for audit / SOC 2 evidence.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {q.isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
          {q.isError && (
            <div className="rounded-md border border-destructive/20 bg-destructive/5 p-6 text-center">
              <div className="text-sm font-medium text-destructive">Failed to load SSO configuration</div>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => q.refetch()}>Retry</Button>
            </div>
          )}
          {q.data && q.data.length === 0 && (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              No rotations recorded yet.
            </div>
          )}
          {q.data?.map((h: any) => (
            <div key={h.id} className="rounded-md border p-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-mono">{h.fingerprint}</span>
                <Badge variant="outline" className="text-[10px]">{h.source}</Badge>
              </div>
              <div className="mt-1 text-muted-foreground">
                {new Date(h.rotated_at).toLocaleString()}
                {h.not_after && ` · valid until ${new Date(h.not_after).toLocaleDateString()}`}
              </div>
              {h.note && <div className="mt-1 italic">{h.note}</div>}
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Generic OIDC form section ---------- */

function OidcFormSection({
  editing,
  onEdit,
}: {
  editing: Partial<SsoRow> & { client_secret?: string | null };
  onEdit: (v: Partial<SsoRow> & { client_secret?: string | null }) => void;
}) {
  const qc = useQueryClient();
  const discover = useServerFn(importOidcDiscovery);
  const discoveryPreviewOnly = !editing.id;
  const [rotating, setRotating] = useState(false);

  const runDiscovery = useMutation({
    mutationFn: () =>
      discover({
        data: {
          id: editing.id!,
          tenant_id: editing.tenant_id!,
          discovery_url: editing.discovery_url ?? null,
          issuer_url: editing.issuer_url ?? null,
        },
      }),
    onSuccess: (r) => {
      toast.success(`Discovered ${r.discovered.issuer}`);
      onEdit({
        ...editing,
        issuer_url: r.discovered.issuer,
        authorization_endpoint: r.discovered.authorization_endpoint ?? null,
        token_endpoint: r.discovered.token_endpoint ?? null,
        userinfo_endpoint: r.discovered.userinfo_endpoint ?? null,
        jwks_uri: r.discovered.jwks_uri ?? null,
      });
      qc.invalidateQueries({ queryKey: ["sso", editing.tenant_id] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <Alert>
        <KeyRound className="h-4 w-4" />
        <AlertTitle className="text-xs">Generic OpenID Connect provider</AlertTitle>
        <AlertDescription className="text-xs">
          Works with Okta, Auth0, Keycloak, PingOne, Azure Entra, Cognito, Ory Hydra, ForgeRock, or
          any spec-compliant issuer. Paste an issuer URL and click <em>Discover</em> to auto-fill
          endpoints and JWKS from <code>.well-known/openid-configuration</code>.
        </AlertDescription>
      </Alert>

      <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
        <div className="space-y-1">
          <Label>Issuer URL</Label>
          <Input
            value={editing.issuer_url ?? ""}
            onChange={(e) => onEdit({ ...editing, issuer_url: e.target.value })}
            placeholder="https://auth.demo-bank.example"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={
            discoveryPreviewOnly ||
            runDiscovery.isPending ||
            (!editing.discovery_url && !editing.issuer_url)
          }
          onClick={() => runDiscovery.mutate()}
          title={discoveryPreviewOnly ? "Save the provider first, then run discovery" : "Fetch OIDC discovery document"}
        >
          <RefreshCw className={`mr-1 h-3.5 w-3.5 ${runDiscovery.isPending ? "animate-spin" : ""}`} />
          Discover
        </Button>
      </div>

      <div className="space-y-1">
        <Label>
          Discovery URL{" "}
          <span className="text-xs text-muted-foreground">
            (optional — defaults to <code>{"{issuer}/.well-known/openid-configuration"}</code>)
          </span>
        </Label>
        <Input
          value={editing.discovery_url ?? ""}
          onChange={(e) => onEdit({ ...editing, discovery_url: e.target.value })}
          placeholder="https://auth.demo-bank.example/.well-known/openid-configuration"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Client ID</Label>
          <Input
            value={editing.client_id ?? ""}
            onChange={(e) => onEdit({ ...editing, client_id: e.target.value })}
            placeholder="0oab1c2d3e4F5g6H7i8j"
          />
        </div>
        <div className="space-y-1">
          <Label>
            Client Secret{" "}
            {editing.client_secret_last4 && !rotating && (
              <span className="text-xs text-muted-foreground">
                (stored — ends in <code>••••{editing.client_secret_last4}</code>)
              </span>
            )}
          </Label>
          {editing.client_secret_last4 && !rotating ? (
            <div className="flex gap-2">
              <Input value="••••••••••••••••" disabled />
              <Button type="button" size="sm" variant="outline" onClick={() => setRotating(true)}>
                Rotate
              </Button>
            </div>
          ) : (
            <PasswordInput
              revealLabel="client secret"
              autoComplete="new-password"
              value={editing.client_secret ?? ""}
              onChange={(e) => onEdit({ ...editing, client_secret: e.target.value })}
              placeholder={rotating ? "Enter new client secret" : "Paste client secret"}
            />
          )}
        </div>
      </div>

      <div className="space-y-1">
        <Label>Scopes (space or comma separated)</Label>
        <Input
          value={(editing.scopes ?? []).join(" ")}
          onChange={(e) =>
            onEdit({
              ...editing,
              scopes: e.target.value.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean),
            })
          }
          placeholder="openid profile email groups"
        />
        <p className="text-xs text-muted-foreground">
          <code>openid</code> is required. Add <code>groups</code>, <code>offline_access</code>, or provider-specific
          scopes as your IdP requires.
        </p>
      </div>

      <div className="space-y-1">
        <Label>Redirect URIs (one per line)</Label>
        <Textarea
          rows={3}
          className="font-mono text-xs"
          value={(editing.redirect_uris ?? []).join("\n")}
          onChange={(e) =>
            onEdit({
              ...editing,
              redirect_uris: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean),
            })
          }
          placeholder={`https://app.reconiq.example/auth/callback\nhttps://${editing.tenant_id ? "tenant" : "app"}.reconiq.example/auth/callback`}
        />
        <p className="text-xs text-muted-foreground">
          Register each of these URLs in the IdP's client configuration exactly as shown.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Response Type</Label>
          <Select
            value={editing.response_type ?? "code"}
            onValueChange={(v) => onEdit({ ...editing, response_type: v as SsoRow["response_type"] })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="code">Authorization Code (recommended)</SelectItem>
              <SelectItem value="code id_token">Hybrid (code id_token)</SelectItem>
              <SelectItem value="id_token">Implicit (id_token)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between rounded-md border p-3">
          <div className="text-sm">PKCE (S256)</div>
          <Switch
            checked={editing.pkce_enabled ?? true}
            onCheckedChange={(v) => onEdit({ ...editing, pkce_enabled: v })}
          />
        </div>
      </div>

      {(editing.authorization_endpoint || editing.token_endpoint || editing.jwks_uri) && (
        <div className="rounded-md border bg-muted/30 p-3 text-[11px] font-mono space-y-1">
          {editing.authorization_endpoint && (
            <div><span className="text-muted-foreground">authorization:</span> {editing.authorization_endpoint}</div>
          )}
          {editing.token_endpoint && (
            <div><span className="text-muted-foreground">token:</span> {editing.token_endpoint}</div>
          )}
          {editing.userinfo_endpoint && (
            <div><span className="text-muted-foreground">userinfo:</span> {editing.userinfo_endpoint}</div>
          )}
          {editing.jwks_uri && (
            <div><span className="text-muted-foreground">jwks_uri:</span> {editing.jwks_uri}</div>
          )}
          {editing.discovery_fetched_at && (
            <div className="text-muted-foreground pt-1">
              discovered {new Date(editing.discovery_fetched_at).toLocaleString()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
