import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Fingerprint, ShieldCheck, Info, Zap } from "lucide-react";
import { listAuthProviders, setAuthProviderEnabled, type AuthProviderRow } from "@/lib/auth-providers.functions";
import { ScimProvisioningTab } from "@/components/scim-provisioning-tab";
import { useStepUpFlow } from "@/components/step-up-dialog";
import { toast } from "sonner";

export function AuthProvidersTab() {
  const list = useServerFn(listAuthProviders);
  const setEnabled = useServerFn(setAuthProviderEnabled);
  const qc = useQueryClient();

  const { data: rows, isLoading } = useQuery({
    queryKey: ["platform-auth-providers"],
    queryFn: () => list(),
  });

  const flow = useStepUpFlow<{ provider: string; enabled: boolean }>({
    actionKey: "auth_provider.toggle",
    actionLabel: "toggle a platform sign-in provider",
    run: async (v) => {
      const prev = qc.getQueryData<AuthProviderRow[]>(["platform-auth-providers"]);
      qc.setQueryData<AuthProviderRow[]>(["platform-auth-providers"], (old) =>
        (old ?? []).map((r) => (r.provider === v.provider ? { ...r, enabled: v.enabled } : r)),
      );
      try {
        await setEnabled({ data: v });
        toast.success(`${v.provider} sign-in ${v.enabled ? "enabled" : "disabled"}`);
        qc.invalidateQueries({ queryKey: ["platform-auth-providers"] });
      } catch (e) {
        qc.setQueryData(["platform-auth-providers"], prev);
        throw e;
      }
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Auth &amp; identity</h1>
        <p className="text-sm text-muted-foreground">
          External sign-in providers and SCIM 2.0 auto-provisioning for tenant IdPs.
        </p>
      </div>

      <Tabs defaultValue="providers">
        <TabsList>
          <TabsTrigger value="providers"><Fingerprint className="mr-1.5 h-3.5 w-3.5" /> Providers</TabsTrigger>
          <TabsTrigger value="scim"><Zap className="mr-1.5 h-3.5 w-3.5" /> SCIM auto-provisioning</TabsTrigger>
          <TabsTrigger value="advisory"><ShieldCheck className="mr-1.5 h-3.5 w-3.5" /> Enterprise advisory</TabsTrigger>
        </TabsList>

        <TabsContent value="providers" className="mt-4">
          <div className="space-y-4">
            {isLoading && (
              <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading providers…</CardContent></Card>
            )}
            {(!isLoading && !rows) && (
              <Card className="border-destructive/20 bg-destructive/5">
                <CardContent className="p-6 text-center">
                  <div className="text-sm font-medium text-destructive">Failed to load auth providers</div>
                  <Button variant="outline" size="sm" className="mt-2" onClick={() => qc.invalidateQueries({ queryKey: ["platform-auth-providers"] })}>Retry</Button>
                </CardContent>
              </Card>
            )}
            {(rows ?? []).map((row) => (
              <Card key={row.provider}>
                <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                  <div className="space-y-1">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Fingerprint className="h-4 w-4 text-muted-foreground" />
                      {row.label}
                      <Badge variant={row.enabled ? "default" : "secondary"} className="ml-1 text-xs font-normal">
                        {row.enabled ? "Enabled" : "Disabled"}
                      </Badge>
                    </CardTitle>
                    <CardDescription className="max-w-2xl">
                      {row.description}
                      {" "}Requires <code className="rounded bg-muted px-1 py-0.5 text-[11px]">platform_admin</code>.
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <span className="text-xs text-muted-foreground">{row.enabled ? "On" : "Off"}</span>
                    <Switch
                      aria-label={`Toggle ${row.label}`}
                      checked={row.enabled}
                      disabled={flow.busy}
                      onCheckedChange={(checked) =>
                        flow.trigger({ provider: row.provider, enabled: checked })
                      }
                    />
                  </div>
                </CardHeader>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="scim" className="mt-4">
          <ScimProvisioningTab />
        </TabsContent>

        <TabsContent value="advisory" className="mt-4">
          <Card className="border-dashed">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <ShieldCheck className="h-4 w-4 text-primary" />
                Enterprise recommendations
              </CardTitle>
              <CardDescription>
                Advisory guidance from the platform architects — additional identity surfaces to consider for
                regulated / enterprise tenants.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p className="flex items-start gap-2"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span><strong className="text-foreground">SAML 2.0 SSO</strong> (Okta, Ping, ADFS, OneLogin) — mandatory for most Tier-1 bank / insurer procurement. Already available via <em>Identity &amp; Access → SAML SSO</em>; expose per-tenant.</span>
              </p>
              <p className="flex items-start gap-2"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span><strong className="text-foreground">OIDC (generic)</strong> — for customers who standardise on Auth0, Keycloak, Ping OIDC, or Google Workspace OIDC rather than a named provider.</span>
              </p>
              <p className="flex items-start gap-2"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span><strong className="text-foreground">SCIM 2.0 user provisioning</strong> — pair with SAML/OIDC so leavers are de-provisioned automatically (SOX / ISO 27001 access-review control). Configure in the <em>SCIM auto-provisioning</em> tab.</span>
              </p>
              <p className="flex items-start gap-2"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span><strong className="text-foreground">Passkeys / WebAuthn (FIDO2)</strong> — phishing-resistant MFA; PSD2 / NIST 800-63B AAL3 aligned. Roll out after email + one federated IdP.</span>
              </p>
              <p className="flex items-start gap-2"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span><strong className="text-foreground">Enterprise MFA (TOTP + WebAuthn)</strong> and <strong className="text-foreground">step-up auth</strong> on privileged actions (break-glass, key rotation, tenant deletion).</span>
              </p>
              <p className="flex items-start gap-2"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span><strong className="text-foreground">IP allow-listing &amp; device posture</strong> (mTLS / device certificates) per tenant — common Big-4 audit ask.</span>
              </p>
              <p className="text-xs italic">
                The managed backend today supports Google, Apple, and SAML SSO. Microsoft / Entra ID is exposed
                via the SAML flow using Microsoft's federation metadata URL until first-class OIDC lands.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      {flow.dialog}
    </div>
  );
}
