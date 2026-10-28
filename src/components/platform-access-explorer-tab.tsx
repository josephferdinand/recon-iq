/**
 * @deprecated Retire per APP_RATIONALIZATION_2026-07-17 QW#5. Replace with
 * scope-switcher-enabled `<AccessExplorer />` inside `/hub/access`. This
 * file remains a thin wrapper today for existing `page=access-explorer`
 * deep links.
 *
 * Platform-scope wrapper around <AccessExplorer>: lets a platform admin
 * pick any tenant and inspect any member's effective access.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listAllTenants } from "@/lib/tenants.functions";
import { AccessExplorer } from "@/components/access-explorer";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { DeprecatedBanner } from "@/components/deprecated-banner";

export function PlatformAccessExplorerTab() {
  const fetchTenants = useServerFn(listAllTenants);
  const tenantsQ = useQuery({
    queryKey: ["platform-tenants-for-access"],
    queryFn: () => fetchTenants(),
    staleTime: 60_000,
  });
  const [tenantId, setTenantId] = useState<string>("");

  return (
    <div className="space-y-4">
      <DeprecatedBanner
        successorLabel="Access hub — Access Explorer (scope switcher)"
        successorHref="/hub/access"
        note="This wrapper is superseded by the scope-switcher-enabled Access Explorer inside /hub/access."
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Platform access explorer</CardTitle>
          <CardDescription>
            Inspect the effective permissions of any user inside any tenant.
            Resolution is performed server-side using the same RPC that powers
            workspace/tenant gating, so results match production behaviour.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-w-sm">
            <Select value={tenantId} onValueChange={setTenantId}>
              <SelectTrigger><SelectValue placeholder="Choose tenant…" /></SelectTrigger>
              <SelectContent>
                {(tenantsQ.data ?? []).map((t: any) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name} · /{t.slug}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>
      {tenantId ? <AccessExplorer tenantId={tenantId} /> : null}
    </div>
  );
}
