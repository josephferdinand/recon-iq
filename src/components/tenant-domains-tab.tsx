import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listTenantEnvironments,
  listCustomDomains,
  addCustomDomain,
  removeCustomDomain,
  verifyCustomDomain,
} from "@/lib/tenant-host.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Globe, ExternalLink, ShieldCheck, Copy, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface EnvRow {
  id: string; env: "prod" | "dev" | "sandbox" | "uat";
  host: string; is_active: boolean;
  tls_status: string; health_status: string;
  last_health_check_at: string | null;
}
interface CustomDomainRow {
  id: string; env: "prod" | "dev" | "sandbox" | "uat";
  host: string; verification_status: "pending" | "verified" | "failed" | "revoked";
  verified_at: string | null;
  tls_status: string;
  health_status: string;
  verification_token: string;
  last_verification_check_at: string | null;
  last_health_check_at: string | null;
  created_at: string;
}

const envLabels: Record<string, string> = {
  prod: "Production", dev: "Development", sandbox: "Sandbox", uat: "UAT",
};

function StatusBadge({ status }: { status: string }) {
  const cls: Record<string, string> = {
    verified: "text-emerald-600 border-emerald-600/40",
    healthy:  "text-emerald-600 border-emerald-600/40",
    active:   "text-emerald-600 border-emerald-600/40",
    pending:  "text-amber-600 border-amber-600/40",
    provisioning: "text-amber-600 border-amber-600/40",
    failed:   "text-destructive border-destructive/40",
    down:     "text-destructive border-destructive/40",
    revoked:  "text-muted-foreground",
  };
  return <Badge variant="outline" className={cls[status] ?? "text-muted-foreground"}>{status}</Badge>;
}

function copyHost(h: string) {
  navigator.clipboard.writeText(`https://${h}`);
  toast.success("URL copied");
}

export function TenantDomainsTab({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const listEnvs = useServerFn(listTenantEnvironments);
  const listCustom = useServerFn(listCustomDomains);
  const addCustom = useServerFn(addCustomDomain);
  const verifyCustom = useServerFn(verifyCustomDomain);
  const removeCustom = useServerFn(removeCustomDomain);

  const envs = useQuery({
    queryKey: ["tenant-envs", tenantId],
    queryFn: () => listEnvs({ data: { tenant_id: tenantId } }),
  });
  const customs = useQuery({
    queryKey: ["tenant-custom-domains", tenantId],
    queryFn: () => listCustom({ data: { tenant_id: tenantId } }),
  });

  const envRows = (envs.data as EnvRow[] | undefined) ?? [];
  const customRows = (customs.data as CustomDomainRow[] | undefined) ?? [];

  const addMut = useMutation({
    mutationFn: (vars: { host: string; env: "prod" | "dev" | "sandbox" | "uat" }) =>
      addCustom({ data: { tenant_id: tenantId, host: vars.host, env: vars.env } }),
    onSuccess: () => {
      toast.success("Custom domain added — add the DNS records to verify");
      qc.invalidateQueries({ queryKey: ["tenant-custom-domains", tenantId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const verifyMut = useMutation({
    mutationFn: (id: string) => verifyCustom({ data: { id } }),
    onSuccess: (res) => {
      if (res.verified) toast.success("Domain verified");
      else toast.error("Verification failed — TXT record not found yet");
      qc.invalidateQueries({ queryKey: ["tenant-custom-domains", tenantId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeMut = useMutation({
    mutationFn: (id: string) => removeCustom({ data: { id } }),
    onSuccess: () => {
      toast.success("Custom domain removed");
      qc.invalidateQueries({ queryKey: ["tenant-custom-domains", tenantId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Globe className="h-4 w-4" />Tenant URLs</CardTitle>
          <CardDescription>
            Each tenant is reachable at <span className="font-mono">{"{slug}.reconiq.example"}</span> with
            isolated <span className="font-mono">-dev</span>, <span className="font-mono">-sandbox</span>, and
            <span className="font-mono"> -uat</span> environments. TLS is served from the platform wildcard certificate.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {envRows.map((r) => (
            <div key={r.id} className="border rounded-lg p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant={r.env === "prod" ? "default" : "secondary"}>{envLabels[r.env] ?? r.env}</Badge>
                  {r.is_active
                    ? <Badge variant="outline" className="text-emerald-600 border-emerald-600/40">Active</Badge>
                    : <Badge variant="outline" className="text-muted-foreground">Inactive</Badge>}
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  TLS: {r.tls_status}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <code className="text-sm font-mono flex-1 truncate">{r.host}</code>
                <Button size="icon" variant="ghost" onClick={() => copyHost(r.host)} title="Copy URL">
                  <Copy className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" asChild title="Open">
                  <a href={`https://${r.host}`} target="_blank" rel="noreferrer">
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </Button>
              </div>
              <div className="text-xs text-muted-foreground">
                Health: <span className="font-medium">{r.health_status}</span>
                {r.last_health_check_at
                  ? ` · last checked ${new Date(r.last_health_check_at).toLocaleString()}`
                  : " · never checked"}
              </div>
            </div>
          ))}
          {envRows.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No environments provisioned. Environments are created automatically when the tenant is created.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Custom domains (BYO)</CardTitle>
            <CardDescription>
              Bring your own hostname (e.g. <span className="font-mono">recon.bank.com</span>). Verification is by
              DNS <span className="font-mono">TXT</span> record on <span className="font-mono">_fvi-verify.&lt;host&gt;</span>.
              Once verified, point a <span className="font-mono">CNAME</span> at
              <span className="font-mono"> reconintelligence.app</span> and the ReconIQ edge issues a managed certificate
              (SOC 2 CC8.1 change record auto-logged).
            </CardDescription>
          </div>
          <AddCustomDomainDialog onSubmit={(host, env) => addMut.mutate({ host, env })} pending={addMut.isPending} />
        </CardHeader>
        <CardContent className="space-y-3">
          {customRows.length === 0 && (
            <p className="text-sm text-muted-foreground">No custom domains yet. Click <strong>Add custom domain</strong> to start.</p>
          )}
          {customRows.map((r) => (
            <div key={r.id} className="border rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <code className="text-sm font-mono">{r.host}</code>
                  <Badge variant="secondary">{envLabels[r.env] ?? r.env}</Badge>
                  <StatusBadge status={r.verification_status} />
                  <Badge variant="outline">TLS: {r.tls_status}</Badge>
                </div>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="outline" onClick={() => verifyMut.mutate(r.id)} disabled={verifyMut.isPending}>
                    <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${verifyMut.isPending ? "animate-spin" : ""}`} />
                    Verify
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => copyHost(r.host)} title="Copy URL">
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="ghost" asChild title="Open">
                    <a href={`https://${r.host}`} target="_blank" rel="noreferrer">
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => {
                    if (confirm(`Remove custom domain ${r.host}? Active sessions on this host will be terminated.`)) {
                      removeMut.mutate(r.id);
                    }
                  }} title="Remove">
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>

              {r.verification_status !== "verified" && (
                <div className="rounded-md bg-muted/40 p-3 text-xs space-y-2">
                  <p className="font-medium text-foreground">DNS records to add at your registrar:</p>
                  <div className="font-mono leading-relaxed">
                    <div><span className="text-muted-foreground">Type:</span> TXT</div>
                    <div><span className="text-muted-foreground">Name:</span> _fvi-verify.{r.host}</div>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">Value:</span>
                      <code className="bg-background px-1.5 py-0.5 rounded border">{r.verification_token}</code>
                      <Button size="icon" variant="ghost" className="h-6 w-6"
                        onClick={() => { navigator.clipboard.writeText(r.verification_token); toast.success("Token copied"); }}>
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                    <div className="pt-2"><span className="text-muted-foreground">Then add:</span> CNAME {r.host} → reconintelligence.app</div>
                  </div>
                  {r.last_verification_check_at && (
                    <p className="text-muted-foreground">
                      Last check: {new Date(r.last_verification_check_at).toLocaleString()}
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function AddCustomDomainDialog({
  onSubmit, pending,
}: { onSubmit: (host: string, env: "prod" | "dev" | "sandbox" | "uat") => void; pending: boolean }) {
  const [open, setOpen] = useState(false);
  const [host, setHost] = useState("");
  const [env, setEnv] = useState<"prod" | "dev" | "sandbox" | "uat">("prod");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="h-4 w-4 mr-1.5" />Add custom domain</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add custom domain</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="cd-host">Hostname</Label>
            <Input id="cd-host" placeholder="recon.bank.com" value={host}
              onChange={(e) => setHost(e.target.value)} autoComplete="off" />
            <p className="text-xs text-muted-foreground">
              Lowercase letters, digits, hyphens, dots. Must not end in <code>.reconiq.example</code>.
            </p>
          </div>
          <div className="space-y-1">
            <Label>Environment</Label>
            <Select value={env} onValueChange={(v) => setEnv(v as typeof env)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="prod">Production</SelectItem>
                <SelectItem value="dev">Development</SelectItem>
                <SelectItem value="sandbox">Sandbox</SelectItem>
                <SelectItem value="uat">UAT</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={pending || !host.trim()} onClick={() => {
            onSubmit(host.trim(), env);
            setOpen(false);
            setHost("");
          }}>Add domain</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
