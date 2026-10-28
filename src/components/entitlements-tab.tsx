import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listAllTenants } from "@/lib/tenants.functions";
import { listEntitlements, setEntitlement } from "@/lib/platform-ai.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import { toast } from "sonner";
import { ToggleLeft } from "lucide-react";

export function EntitlementsTab() {
  const fetchTenants = useServerFn(listAllTenants);
  const tenantsQ = useQuery({ queryKey: ["platform-tenants"], queryFn: () => fetchTenants() });
  const [tenantId, setTenantId] = useState<string>("");

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ToggleLeft className="h-4 w-4" /> Feature entitlements</CardTitle>
          <CardDescription>Choose a tenant to enable or lock individual features per plan.</CardDescription>
        </CardHeader>
        <CardContent>
          <Select value={tenantId} onValueChange={setTenantId}>
            <SelectTrigger className="max-w-md"><SelectValue placeholder="e.g. Demo Bank NA" /></SelectTrigger>
            <SelectContent>
              {(tenantsQ.data ?? []).map((t: any) => (
                <SelectItem key={t.id} value={t.id}>{t.name} (/{t.slug})</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>
      {tenantId ? <EntitlementsTable tenantId={tenantId} /> : null}
    </div>
  );
}

function EntitlementsTable({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const list = useServerFn(listEntitlements);
  const upd = useServerFn(setEntitlement);
  const q = useQuery({ queryKey: ["entitlements", tenantId], queryFn: () => list({ data: { tenant_id: tenantId } }) });

  const m = useMutation({
    mutationFn: (v: any) => upd({ data: v }),
    onSuccess: () => { toast.success("Entitlement updated"); qc.invalidateQueries({ queryKey: ["entitlements", tenantId] }); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Card>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-2">Feature</th>
              <th className="px-4 py-2">Category</th>
              <th className="px-4 py-2">Min plan</th>
              <th className="px-4 py-2">Allowed</th>
            </tr>
          </thead>
          <tbody>
            {(q.data ?? []).map((f: any) => (
              <tr key={f.key} className="border-b">
                <td className="px-4 py-2">
                  <div className="font-medium">{f.label}</div>
                  <div className="text-xs text-muted-foreground">{f.description}</div>
                </td>
                <td className="px-4 py-2"><Badge variant="outline">{f.category}</Badge></td>
                <td className="px-4 py-2">
                  <Select value={f.plan_required} onValueChange={(v) =>
                    m.mutate({ tenant_id: tenantId, feature_key: f.key, allowed: f.allowed, plan_required: v })}>
                    <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="starter">Starter</SelectItem>
                      <SelectItem value="professional">Professional</SelectItem>
                      <SelectItem value="enterprise">Enterprise</SelectItem>
                    </SelectContent>
                  </Select>
                </td>
                <td className="px-4 py-2">
                  <Switch checked={!!f.allowed} onCheckedChange={(v) =>
                    m.mutate({ tenant_id: tenantId, feature_key: f.key, allowed: v, plan_required: f.plan_required })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
