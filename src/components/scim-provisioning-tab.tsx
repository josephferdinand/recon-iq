import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Copy, KeyRound, Link2, Loader2, Plus, RefreshCw, ScrollText, ShieldCheck, Trash2, Users, Zap,
} from "lucide-react";
import {
  getScimSettings, upsertScimSettings, toggleScimEnabled, listAdministrableTenants,
} from "@/lib/scim-provisioning.functions";
import {
  listScimTokens, createScimToken, revokeScimToken, listScimSyncLog,
} from "@/lib/scim.functions";
import { useStepUpFlow } from "@/components/step-up-dialog";

const DEFAULT_MAPPING: Record<string, string> = {
  userName: "userName",
  email: "emails[primary].value",
  givenName: "name.givenName",
  familyName: "name.familyName",
  displayName: "displayName",
  externalId: "externalId",
  active: "active",
  department: "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User.department",
  title: "title",
  groups: "groups[].display",
};

const copy = (v: string, label = "Copied to clipboard") => {
  navigator.clipboard.writeText(v).then(() => toast.success(label));
};

export function ScimProvisioningTab() {
  const listTenantsFn = useServerFn(listAdministrableTenants);
  const tenantsQ = useQuery({ queryKey: ["scim","tenants"], queryFn: () => listTenantsFn() });
  const [tenantId, setTenantId] = useState<string>("");

  useEffect(() => {
    if (!tenantId && tenantsQ.data?.[0]) setTenantId(tenantsQ.data[0].id);
  }, [tenantsQ.data, tenantId]);

  if (tenantsQ.isLoading) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground p-6"><Loader2 className="h-4 w-4 animate-spin" /> Loading tenants…</div>;
  }
  if (!tenantsQ.data || tenantsQ.data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">No tenant access</CardTitle>
          <CardDescription>SCIM auto-provisioning is configured per tenant. You need <code className="rounded bg-muted px-1 text-[11px]">tenant_admin</code> or <code className="rounded bg-muted px-1 text-[11px]">platform_admin</code> to see this panel.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">SCIM 2.0 auto-provisioning</h2>
          <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
            Automate user and group lifecycle from your IdP (Okta, Azure AD/Entra, JumpCloud, Google Workspace).
            Configure the base URL, provision a bearer token, and map SCIM attributes to your tenant's user schema.
            Every change is recorded in the audit log.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Tenant</Label>
          <Select value={tenantId} onValueChange={setTenantId}>
            <SelectTrigger className="w-[280px]"><SelectValue placeholder="Select tenant…" /></SelectTrigger>
            <SelectContent>
              {tenantsQ.data.map((t) => (
                <SelectItem key={t.id} value={t.id}>{t.name} <span className="text-muted-foreground">({t.slug})</span></SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {tenantId && <ScimTenantConfig key={tenantId} tenantId={tenantId} />}
    </div>
  );
}

function ScimTenantConfig({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const getFn = useServerFn(getScimSettings);
  const saveFn = useServerFn(upsertScimSettings);
  const toggleFn = useServerFn(toggleScimEnabled);

  const settingsQ = useQuery({
    queryKey: ["scim","settings", tenantId],
    queryFn: () => getFn({ data: { tenant_id: tenantId } }),
  });

  const s = settingsQ.data;
  const [enabled, setEnabled] = useState(false);
  const [autoDeprov, setAutoDeprov] = useState(true);
  const [defaultRole, setDefaultRole] = useState<string>("tenant_member");
  const [baseOverride, setBaseOverride] = useState<string>("");
  const [mappingText, setMappingText] = useState<string>("");
  const [mappingError, setMappingError] = useState<string>("");

  useEffect(() => {
    if (!s) return;
    setEnabled(!!s.enabled);
    setAutoDeprov(!!s.auto_deprovision);
    setDefaultRole(String(s.default_role || "tenant_member"));
    setBaseOverride(s.base_url_override || "");
    const m = (s.attribute_mapping as Record<string, string>) || DEFAULT_MAPPING;
    setMappingText(JSON.stringify(m, null, 2));
    setMappingError("");
  }, [s]);

  const defaultBaseUrl = useMemo(
    () => typeof window !== "undefined" ? `${window.location.origin}/api/public/scim/v2` : "/api/public/scim/v2",
    [],
  );
  const effectiveBaseUrl = (baseOverride || defaultBaseUrl).replace(/\/+$/, "");
  const tenantEndpoint = `${effectiveBaseUrl}/${tenantId}`;

  const toggleFlow = useStepUpFlow<boolean>({
    actionKey: "scim.toggle",
    actionLabel: "enable or disable SCIM auto-provisioning",
    run: async (v) => {
      setEnabled(v);
      try {
        await toggleFn({ data: { tenant_id: tenantId, enabled: v } });
        toast.success(`SCIM auto-provisioning ${v ? "enabled" : "disabled"}`);
        qc.invalidateQueries({ queryKey: ["scim","settings", tenantId] });
      } catch (e) {
        setEnabled(!v);
        throw e;
      }
    },
  });

  const saveFlow = useStepUpFlow<{ mapping: Record<string, string> }>({
    actionKey: "scim.settings.write",
    actionLabel: "change SCIM provisioning settings",
    run: async ({ mapping }) => {
      await saveFn({
        data: {
          tenant_id: tenantId,
          enabled,
          auto_deprovision: autoDeprov,
          default_role: defaultRole as "tenant_member" | "tenant_viewer" | "tenant_admin",
          base_url_override: baseOverride ? baseOverride : null,
          attribute_mapping: mapping,
        },
      });
      setMappingError("");
      toast.success("SCIM settings saved");
      qc.invalidateQueries({ queryKey: ["scim","settings", tenantId] });
    },
  });

  function submitSave() {
    let mapping: Record<string, string>;
    try {
      mapping = JSON.parse(mappingText);
    } catch {
      setMappingError("Attribute mapping must be valid JSON");
      toast.error("Attribute mapping must be valid JSON");
      return;
    }
    if (typeof mapping !== "object" || Array.isArray(mapping) || mapping === null) {
      setMappingError("Attribute mapping must be a JSON object");
      return;
    }
    for (const [k, v] of Object.entries(mapping)) {
      if (typeof v !== "string") { setMappingError(`Mapping for "${k}" must be a string`); return; }
    }
    saveFlow.trigger({ mapping });
  }

  if (settingsQ.isLoading) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground p-6"><Loader2 className="h-4 w-4 animate-spin" /> Loading settings…</div>;
  }

  return (
    <div className="space-y-6">
      {/* Master toggle */}
      <Card className={enabled ? "border-emerald-500/40" : ""}>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Zap className="h-4 w-4 text-emerald-500" /> Auto-provisioning
              <Badge variant={enabled ? "default" : "secondary"}>{enabled ? "Enabled" : "Disabled"}</Badge>
            </CardTitle>
            <CardDescription>
              When enabled, your IdP can create, update, and deactivate users and groups via SCIM 2.0.
              A valid bearer token is required — see the Tokens section below.
            </CardDescription>
          </div>
          <Switch
            aria-label="Toggle SCIM auto-provisioning"
            checked={enabled}
            disabled={toggleFlow.busy}
            onCheckedChange={(v) => toggleFlow.trigger(v)}
          />
        </CardHeader>
      </Card>

      {/* Endpoint */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Link2 className="h-4 w-4" /> SCIM endpoint</CardTitle>
          <CardDescription>Paste this URL into your IdP's SCIM connector.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Tenant SCIM URL</Label>
            <div className="flex gap-2">
              <Input readOnly value={tenantEndpoint} className="font-mono text-xs" />
              <Button variant="outline" size="icon" onClick={() => copy(tenantEndpoint, "SCIM URL copied")}><Copy className="h-4 w-4" /></Button>
            </div>
            <p className="text-xs text-muted-foreground">Supports <code>/Users</code>, <code>/Groups</code>, <code>/ServiceProviderConfig</code>, <code>/Schemas</code>.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="base-override">Base URL override <span className="text-muted-foreground">(optional)</span></Label>
            <Input
              id="base-override"
              placeholder={defaultBaseUrl}
              value={baseOverride}
              onChange={(e) => setBaseOverride(e.target.value)}
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">Use a custom domain (e.g. <code>https://scim.yourbrand.com/v2</code>) that CNAMEs to this platform.</p>
          </div>
        </CardContent>
      </Card>

      {/* Behavior */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4" /> Provisioning behaviour</CardTitle>
          <CardDescription>Control how incoming SCIM operations map to tenant membership.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-2">
          <div className="flex items-start justify-between rounded-lg border p-4">
            <div>
              <div className="text-sm font-medium">Auto-deprovision on delete</div>
              <p className="mt-1 text-xs text-muted-foreground">Deactivate the tenant membership when the IdP sends DELETE or <code>active=false</code>.</p>
            </div>
            <Switch checked={autoDeprov} onCheckedChange={setAutoDeprov} />
          </div>
          <div className="space-y-2 rounded-lg border p-4">
            <Label className="text-sm font-medium">Default role for provisioned users</Label>
            <Select value={defaultRole} onValueChange={setDefaultRole}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="tenant_viewer">tenant_viewer</SelectItem>
                <SelectItem value="tenant_member">tenant_member</SelectItem>
                <SelectItem value="tenant_admin">tenant_admin</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Role assigned when a new user is provisioned. Group mappings can escalate.</p>
          </div>
        </CardContent>
      </Card>

      {/* Attribute mapping */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4" /> Attribute mapping</CardTitle>
          <CardDescription>
            JSON map of internal field → SCIM path. Supports dot notation, primary filter (<code>emails[primary].value</code>),
            array first-element (<code>groups[].display</code>), and enterprise extension URNs.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={mappingText}
            onChange={(e) => setMappingText(e.target.value)}
            rows={14}
            className="font-mono text-xs"
            spellCheck={false}
          />
          {mappingError && <p className="text-xs text-destructive">{mappingError}</p>}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setMappingText(JSON.stringify(DEFAULT_MAPPING, null, 2))}>
              Reset to defaults
            </Button>
            <Button variant="outline" size="sm" onClick={() => {
              try {
                const p = JSON.parse(mappingText);
                setMappingText(JSON.stringify(p, null, 2));
                setMappingError("");
              } catch (e) { setMappingError((e as Error).message); }
            }}>Format JSON</Button>
          </div>
        </CardContent>
        <CardFooter className="flex justify-end gap-2 border-t pt-4">
          <Button variant="ghost" onClick={() => settingsQ.refetch()} disabled={settingsQ.isFetching}>
            <RefreshCw className={`mr-2 h-4 w-4 ${settingsQ.isFetching ? "animate-spin" : ""}`} /> Reload
          </Button>
          <Button onClick={submitSave} disabled={saveFlow.busy}>
            {saveFlow.busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save settings
          </Button>
        </CardFooter>
      </Card>

      <ScimTokensCard tenantId={tenantId} />
      <ScimSyncLogCard tenantId={tenantId} />
      {toggleFlow.dialog}
      {saveFlow.dialog}
    </div>
  );
}

function ScimTokensCard({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listScimTokens);
  const createFn = useServerFn(createScimToken);
  const revokeFn = useServerFn(revokeScimToken);
  const tokensQ = useQuery({
    queryKey: ["scim","tokens", tenantId],
    queryFn: () => listFn({ data: { tenant_id: tenantId } }),
  });

  const [label, setLabel] = useState("");
  const [expiresAt, setExpiresAt] = useState<string>("");
  const [issued, setIssued] = useState<{ token: string; prefix: string } | null>(null);
  const [open, setOpen] = useState(false);

  const create = useMutation({
    mutationFn: () => createFn({
      data: {
        tenant_id: tenantId,
        label: label.trim(),
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
      },
    }),
    onSuccess: (r) => {
      setIssued({ token: r.token, prefix: r.prefix });
      qc.invalidateQueries({ queryKey: ["scim","tokens", tenantId] });
      toast.success("SCIM token created");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => revokeFn({ data: { id, tenant_id: tenantId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scim","tokens", tenantId] });
      toast.success("Token revoked");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base"><KeyRound className="h-4 w-4" /> Bearer tokens</CardTitle>
          <CardDescription>Tokens are hashed at rest — the full value is shown only once at creation.</CardDescription>
        </div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setIssued(null); setLabel(""); setExpiresAt(""); } }}>
          <DialogTrigger asChild><Button size="sm"><Plus className="mr-2 h-4 w-4" /> New token</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create SCIM bearer token</DialogTitle>
              <DialogDescription>Copy the token immediately — it will not be shown again.</DialogDescription>
            </DialogHeader>
            {!issued ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Label</Label>
                  <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Okta prod, Entra staging…" maxLength={80} />
                </div>
                <div className="space-y-2">
                  <Label>Expires at <span className="text-muted-foreground">(optional)</span></Label>
                  <Input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <Label>Token</Label>
                <div className="flex gap-2">
                  <Input readOnly value={issued.token} className="font-mono text-xs" />
                  <Button variant="outline" size="icon" onClick={() => copy(issued.token, "Token copied")}><Copy className="h-4 w-4" /></Button>
                </div>
                <p className="text-xs text-muted-foreground">Paste this into your IdP's SCIM connector "Bearer token" field. Prefix <code>{issued.prefix}</code> is stored for reference.</p>
              </div>
            )}
            <DialogFooter>
              {!issued ? (
                <Button onClick={() => create.mutate()} disabled={create.isPending || label.trim().length < 2}>
                  {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Create
                </Button>
              ) : (
                <Button onClick={() => setOpen(false)}>Done</Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Label</TableHead>
                <TableHead>Prefix</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tokensQ.isLoading && <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground">Loading…</TableCell></TableRow>}
              {tokensQ.data?.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground">No tokens yet.</TableCell></TableRow>}
              {(tokensQ.data ?? []).map((t: any) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.label}</TableCell>
                  <TableCell className="font-mono text-xs">{t.token_prefix}…</TableCell>
                  <TableCell>
                    <Badge variant={t.is_active ? "default" : "secondary"}>{t.is_active ? "Active" : "Revoked"}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{t.last_used_at ? new Date(t.last_used_at).toLocaleString() : "Never"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{t.expires_at ? new Date(t.expires_at).toLocaleString() : "—"}</TableCell>
                  <TableCell className="text-right">
                    {t.is_active && (
                      <Button size="sm" variant="ghost" onClick={() => revoke.mutate(t.id)} disabled={revoke.isPending}>
                        <Trash2 className="mr-1 h-3.5 w-3.5" /> Revoke
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function ScimSyncLogCard({ tenantId }: { tenantId: string }) {
  const listFn = useServerFn(listScimSyncLog);
  const logQ = useQuery({
    queryKey: ["scim","log", tenantId],
    queryFn: () => listFn({ data: { tenant_id: tenantId, limit: 100 } }),
    refetchInterval: 30_000,
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><ScrollText className="h-4 w-4" /> Sync log</CardTitle>
        <CardDescription>Latest 100 SCIM operations received from IdPs.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Resource</TableHead>
                <TableHead>Operation</TableHead>
                <TableHead>External ID</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logQ.isLoading && <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground">Loading…</TableCell></TableRow>}
              {logQ.data?.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground">No SCIM activity yet.</TableCell></TableRow>}
              {(logQ.data ?? []).map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{new Date(r.occurred_at).toLocaleString()}</TableCell>
                  <TableCell><Badge variant="outline">{r.resource_type}</Badge></TableCell>
                  <TableCell className="font-mono text-xs">{r.operation}</TableCell>
                  <TableCell className="font-mono text-xs">{r.external_id ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={r.status_code && r.status_code >= 200 && r.status_code < 300 ? "default" : "destructive"}>
                      {r.status_code ?? "—"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-destructive">{r.error ?? ""}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
