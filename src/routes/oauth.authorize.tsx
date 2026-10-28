import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const searchSchema = z.object({
  response_type: z.literal("code"),
  client_id: z.string().min(1).max(200),
  redirect_uri: z.string().url().max(2000),
  scope: z.string().min(1).max(500),
  state: z.string().max(1000).optional(),
  code_challenge: z.string().min(43).max(128),
  code_challenge_method: z.literal("S256"),
  resource: z.string().url().max(2000).optional(),
});

type TenantChoice = { id: string; name: string; slug: string; role: string };

export const Route = createFileRoute("/oauth/authorize")({
  validateSearch: searchSchema,
  component: MpcOAuthConsent,
});

function MpcOAuthConsent() {
  const search = useSearch({ from: "/oauth/authorize" });
  const navigate = useNavigate();
  const [clientName, setClientName] = useState("MCP client");
  const [tenants, setTenants] = useState<TenantChoice[]>([]);
  const [tenantId, setTenantId] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const scopes = useMemo(() => [...new Set(search.scope.split(/\s+/u).filter(Boolean))], [search.scope]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        const redirect = `${window.location.pathname}${window.location.search}`;
        navigate({ to: "/auth", search: { redirect } as never, replace: true });
        return;
      }
      const metadata = await fetch(`/api/public/oauth/register?client_id=${encodeURIComponent(search.client_id)}&redirect_uri=${encodeURIComponent(search.redirect_uri)}`);
      if (!metadata.ok) {
        if (!cancelled) { setError("This MCP client or callback address is not registered."); setLoading(false); }
        return;
      }
      const meta = await metadata.json() as { client_name: string };
      const tenantResponse = await fetch("/api/public/oauth/mcp-authorize", {
        headers: { authorization: `Bearer ${sessionData.session.access_token}` },
      });
      if (!tenantResponse.ok) {
        if (!cancelled) { setError("Your tenant access could not be loaded."); setLoading(false); }
        return;
      }
      const tenantBody = await tenantResponse.json() as { memberships?: unknown[] };
      const memberships = tenantBody.memberships ?? [];
      type MembershipRow = { role: string; tenants: { id: string; name: string; slug: string } | null };
      const choices = ((memberships ?? []) as unknown as MembershipRow[]).flatMap((row) => row.tenants
        ? [{ id: row.tenants.id, name: row.tenants.name, slug: row.tenants.slug, role: row.role }]
        : []);
      if (!cancelled) {
        setClientName(meta.client_name);
        setTenants(choices);
        setTenantId(choices[0]?.id ?? "");
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [navigate, search.client_id, search.redirect_uri]);

  async function approve() {
    setSubmitting(true);
    setError("");
    const { data } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;
    if (!accessToken) {
      setError("Your session expired. Sign in again to continue.");
      setSubmitting(false);
      return;
    }
    const response = await fetch("/api/public/oauth/mcp-authorize", {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ ...search, tenant_id: tenantId }),
    });
    const body = await response.json() as { redirect_to?: string; error_description?: string };
    if (!response.ok || !body.redirect_to) {
      setError(body.error_description ?? "Authorization could not be completed.");
      setSubmitting(false);
      return;
    }
    window.location.assign(body.redirect_to);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-lg">
        <CardHeader className="space-y-3 text-center">
          <ShieldCheck className="mx-auto h-10 w-10 text-primary" aria-hidden />
          <CardTitle>Authorize ReconIQ</CardTitle>
          <CardDescription>{clientName} is requesting access to one tenant. Access remains limited by your ReconIQ role.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {error ? <Alert variant="destructive"><AlertTitle>Authorization unavailable</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
          <div className="space-y-2">
            <Label htmlFor="oauth-tenant">Tenant</Label>
            <Select value={tenantId} onValueChange={setTenantId} disabled={loading || submitting}>
              <SelectTrigger id="oauth-tenant"><SelectValue placeholder={loading ? "Loading tenants…" : "Select a tenant"} /></SelectTrigger>
              <SelectContent>{tenants.map((tenant) => <SelectItem key={tenant.id} value={tenant.id}>{tenant.name} ({tenant.role})</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Requested access</Label>
            <ul className="rounded-md border bg-muted/30 p-3 text-sm">
              {scopes.map((scope) => <li key={scope} className="py-1 font-mono">{scope}</li>)}
            </ul>
          </div>
          <p className="text-xs text-muted-foreground">ReconIQ records the tenant, user, client and granted scopes. Mutating MCP actions still require explicit confirmation and existing four-eyes controls.</p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => navigate({ to: "/home" })} disabled={submitting}>Cancel</Button>
            <Button onClick={approve} disabled={!tenantId || loading || submitting}>{submitting ? "Authorizing…" : "Authorize"}</Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
