/**
 * @deprecated SCIM v1 tenant tab — superseded by unified "Identity Sync"
 * inside `<AuthProvidersTab />` (which mounts `<ScimProvisioningTab />`).
 * See APP_RATIONALIZATION_2026-07-17 QW#3. Do not extend.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Copy, KeyRound, Plus, Power, AlertCircle, Loader2 } from "lucide-react";
import { listScimTokens, createScimToken, revokeScimToken, listScimSyncLog } from "@/lib/scim.functions";
import { DeprecatedBanner } from "@/components/deprecated-banner";

export function ScimTab({ tenantId, canWrite }: { tenantId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const list = useServerFn(listScimTokens);
  const create = useServerFn(createScimToken);
  const revoke = useServerFn(revokeScimToken);
  const sync = useServerFn(listScimSyncLog);
  const [label, setLabel] = useState("");
  const [reveal, setReveal] = useState<{ prefix: string; token: string } | null>(null);

  const tQ = useQuery({ queryKey: ["scim-tokens", tenantId], queryFn: () => list({ data: { tenant_id: tenantId } }), staleTime: 30_000 });
  const sQ = useQuery({ queryKey: ["scim-sync", tenantId], queryFn: () => sync({ data: { tenant_id: tenantId, limit: 50 } }), staleTime: 30_000 });

  const mCreate = useMutation({
    mutationFn: () => create({ data: { tenant_id: tenantId, label } }),
    onSuccess: (r) => { setReveal({ prefix: r.prefix, token: r.token }); setLabel(""); qc.invalidateQueries({ queryKey: ["scim-tokens", tenantId] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const mRevoke = useMutation({
    mutationFn: (id: string) => revoke({ data: { id, tenant_id: tenantId } }),
    onSuccess: () => { toast.success("Revoked"); qc.invalidateQueries({ queryKey: ["scim-tokens", tenantId] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const scimUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/api/public/scim/v2`;

  if (tQ.isError || sQ.isError) {
    return (
      <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-8 text-center">
        <AlertCircle className="mx-auto h-8 w-8 text-destructive opacity-50" />
        <div className="mt-3 text-sm font-medium text-destructive">Failed to load SCIM configuration</div>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => { tQ.refetch(); sQ.refetch(); }}>
          Retry
        </Button>
      </div>
    );
  }

  if (tQ.isLoading || sQ.isLoading) {
    return (
      <div className="flex items-center justify-center p-12 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading SCIM settings…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <DeprecatedBanner
        successorLabel="Auth providers → Identity Sync (SCIM v2)"
        successorHref="/platform?page=auth-providers"
        note="Standalone SCIM tab is retired. SCIM provisioning is now unified under Auth providers so it sits next to SAML/OIDC federation."
      />
      <Card>
        <CardHeader>
          <CardTitle>SCIM 2.0 provisioning</CardTitle>
          <CardDescription>Connect Okta, Azure AD, OneLogin, JumpCloud. Auto-provision Users and Groups.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="rounded-md border bg-muted/40 p-3 font-mono text-xs break-all">{scimUrl}</div>
          <p className="text-xs text-muted-foreground">Use the Base URL above and a Bearer token below in your IdP's SCIM provisioning settings.</p>
        </CardContent>
      </Card>

      {canWrite ? (
        <Card>
          <CardHeader><CardTitle>Tokens</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input placeholder="e.g. Demo Bank Okta Production" value={label} onChange={(e) => setLabel(e.target.value)} />
              <Button onClick={() => mCreate.mutate()} disabled={!label || mCreate.isPending}>
                <Plus className="mr-2 h-4 w-4" /> Issue token
              </Button>
            </div>
            {reveal ? (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
                <div className="mb-1 font-semibold">One-time reveal — copy now</div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded bg-background px-2 py-1 font-mono text-xs break-all">{reveal.token}</code>
                  <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(reveal.token); toast.success("Copied"); }}>
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
                <button className="mt-2 text-xs underline" onClick={() => setReveal(null)}>I've saved it</button>
              </div>
            ) : null}
            <div className="rounded-md border">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                  <tr><th className="px-4 py-2">Label</th><th className="px-4 py-2">Prefix</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Last used</th><th className="px-4 py-2 text-right">Actions</th></tr>
                </thead>
                <tbody>
                  {(tQ.data ?? []).map((t: any) => (
                    <tr key={t.id} className="border-b">
                      <td className="px-4 py-2">{t.label}</td>
                      <td className="px-4 py-2 font-mono text-xs">{t.token_prefix}…</td>
                      <td className="px-4 py-2">{t.is_active ? <Badge>Active</Badge> : <Badge variant="outline">Revoked</Badge>}</td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">{t.last_used_at ? new Date(t.last_used_at).toLocaleString() : "—"}</td>
                      <td className="px-4 py-2 text-right">
                        {t.is_active ? (
                          <Button size="sm" variant="outline" onClick={() => mRevoke.mutate(t.id)} disabled={mRevoke.isPending}>
                            <Power className="mr-1 h-3 w-3" /> Revoke
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                  {tQ.data && tQ.data.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No tokens issued.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><KeyRound className="h-4 w-4" /> Recent SCIM activity</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr><th className="px-4 py-2">Time</th><th className="px-4 py-2">Op</th><th className="px-4 py-2">Resource</th><th className="px-4 py-2">Status</th></tr>
            </thead>
            <tbody>
              {(sQ.data ?? []).map((r: any) => (
                <tr key={r.id} className="border-b">
                  <td className="px-4 py-2 text-xs text-muted-foreground">{new Date(r.occurred_at).toLocaleString()}</td>
                  <td className="px-4 py-2 font-mono text-xs">{r.operation}</td>
                  <td className="px-4 py-2 text-xs">{r.resource_type}</td>
                  <td className="px-4 py-2"><Badge variant={r.status_code && r.status_code < 400 ? "default" : "outline"}>{r.status_code}</Badge></td>
                </tr>
              ))}
              {sQ.data && sQ.data.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No SCIM events yet.</td></tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
