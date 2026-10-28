import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listTenantIpAllowlist, addTenantIpAllowlist, deleteTenantIpAllowlist,
} from "@/lib/tenant-security.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Shield, Plus, Trash2 } from "lucide-react";

export function TenantIpAllowlistTab({ tenantId, canWrite }: { tenantId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const list = useServerFn(listTenantIpAllowlist);
  const add = useServerFn(addTenantIpAllowlist);
  const del = useServerFn(deleteTenantIpAllowlist);

  const q = useQuery({
    queryKey: ["tenant-ip-allowlist", tenantId],
    queryFn: () => list({ data: { tenant_id: tenantId } }),
  });

  const [cidr, setCidr] = useState("");
  const [label, setLabel] = useState("");

  const addM = useMutation({
    mutationFn: () => add({ data: { tenant_id: tenantId, cidr, label: label || undefined } }),
    onSuccess: () => {
      toast.success("Rule added");
      setCidr(""); setLabel("");
      qc.invalidateQueries({ queryKey: ["tenant-ip-allowlist", tenantId] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const delM = useMutation({
    mutationFn: (id: string) => del({ data: { tenant_id: tenantId, id } }),
    onSuccess: () => {
      toast.success("Rule removed");
      qc.invalidateQueries({ queryKey: ["tenant-ip-allowlist", tenantId] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const rules = q.data?.rules ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Shield className="h-4 w-4" /> IP allowlist</CardTitle>
          <CardDescription>
            When populated, sign-ins and API calls to this tenant are only accepted from the listed CIDR ranges.
            Empty list = no IP restriction. Required by many banking procurement checklists.
          </CardDescription>
        </CardHeader>
        {canWrite ? (
          <CardContent>
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <div className="text-xs text-muted-foreground mb-1">CIDR (IPv4 or IPv6)</div>
                <Input value={cidr} onChange={(e) => setCidr(e.target.value)} placeholder="203.0.113.0/24" className="w-64" />
              </div>
              <div className="flex-1 min-w-[200px]">
                <div className="text-xs text-muted-foreground mb-1">Label (optional)</div>
                <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="London HQ VPN" />
              </div>
              <Button onClick={() => addM.mutate()} disabled={!cidr || addM.isPending}>
                <Plus className="h-4 w-4 mr-1" /> Add
              </Button>
            </div>
          </CardContent>
        ) : null}
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2">CIDR</th>
                <th className="px-4 py-2">Label</th>
                <th className="px-4 py-2">Added</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r: any) => (
                <tr key={r.id} className="border-b">
                  <td className="px-4 py-2 font-mono text-xs">{r.cidr}</td>
                  <td className="px-4 py-2 text-xs">{r.label ?? "—"}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {r.created_at ? new Date(r.created_at).toLocaleString() : "—"}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {canWrite ? (
                      <Button size="sm" variant="ghost" onClick={() => delM.mutate(r.id)} disabled={delM.isPending}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
              {rules.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                    No allowlist rules. All source IPs currently accepted subject to auth.
                    <div className="mt-2"><Badge variant="outline">Not restricted</Badge></div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
