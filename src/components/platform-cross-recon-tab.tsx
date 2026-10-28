import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { listAllTenants } from "@/lib/tenants.functions";
import { getCrossReconIntelligence } from "@/lib/platform-gaps.functions";
import { Network, Package, Copy } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";

export function PlatformCrossReconTab() {
  const tenantsFn = useServerFn(listAllTenants);
  const intelFn = useServerFn(getCrossReconIntelligence);
  const [tenantId, setTenantId] = useState<string>("");
  const [draft, setDraft] = useState<{ open: boolean; suggestion: any | null; tenantSlug: string | null }>(
    { open: false, suggestion: null, tenantSlug: null },
  );

  const tenantsQ = useQuery({ queryKey: ["platform-tenants-select"], queryFn: () => tenantsFn() });
  const intelQ = useQuery({
    queryKey: ["platform-cross-recon", tenantId],
    queryFn: () => intelFn({ data: { tenant_id: tenantId } }),
    enabled: !!tenantId,
  });

  const tenants = (tenantsQ.data ?? []) as any[];
  const selectedTenant = tenants.find((t) => t.id === tenantId);

  const buildPluginMetadata = (s: any) => ({
    plugin_kind: "cross_recon_template",
    name: `Consolidated: ${s.recon_a} + ${s.recon_b}`,
    description: s.rationale,
    shared_fields: s.shared_fields,
    source_recons: [s.recon_a, s.recon_b],
    config_schema: {
      type: "object",
      properties: Object.fromEntries(s.shared_fields.map((f: string) => [f, { type: "string" }])),
    },
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Network className="h-4 w-4" />Cross-recon intelligence</CardTitle>
          <CardDescription>
            Surface duplicate fields and consolidation candidates across a tenant's recon definitions.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-end gap-2">
            <div className="flex-1 max-w-md">
              <Label className="text-xs">Tenant</Label>
              <Select value={tenantId} onValueChange={setTenantId}>
                <SelectTrigger><SelectValue placeholder="Select a tenant…" /></SelectTrigger>
                <SelectContent>
                  {tenants.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name} ({t.slug})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Duplicate field candidates</CardTitle>
          <CardDescription>Field names appearing in ≥ 3 recon definitions.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Field</th>
                <th className="px-3 py-2">Definition count</th>
                <th className="px-3 py-2">Sample recon IDs</th>
              </tr>
            </thead>
            <tbody>
              {!tenantId && (
                <tr><td colSpan={3} className="px-3 py-6 text-center text-muted-foreground text-xs">Select a tenant.</td></tr>
              )}
              {tenantId && intelQ.isLoading && (
                <tr><td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">Loading…</td></tr>
              )}
              {tenantId && (intelQ.data?.duplicate_field_candidates ?? []).length === 0 && !intelQ.isLoading && (
                <tr><td colSpan={3} className="px-3 py-6 text-center text-muted-foreground text-xs">No duplicates found.</td></tr>
              )}
              {(intelQ.data?.duplicate_field_candidates ?? []).map((c) => (
                <tr key={c.field_name} className="border-b">
                  <td className="px-3 py-2 font-mono text-xs">{c.field_name}</td>
                  <td className="px-3 py-2"><Badge variant="secondary">{c.recon_definition_count}</Badge></td>
                  <td className="px-3 py-2 text-xs font-mono text-muted-foreground">
                    {c.sample_recon_ids.map((id) => id.slice(0, 8)).join(", ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Consolidation suggestions</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Recon A</th>
                <th className="px-3 py-2">Recon B</th>
                <th className="px-3 py-2">Shared fields</th>
                <th className="px-3 py-2">Rationale</th>
                <th className="px-3 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {!tenantId && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground text-xs">Select a tenant.</td></tr>
              )}
              {tenantId && (intelQ.data?.consolidation_suggestions ?? []).length === 0 && !intelQ.isLoading && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground text-xs">No suggestions.</td></tr>
              )}
              {(intelQ.data?.consolidation_suggestions ?? []).map((s, i) => (
                <tr key={i} className="border-b">
                  <td className="px-3 py-2">{s.recon_a}</td>
                  <td className="px-3 py-2">{s.recon_b}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{s.shared_fields.slice(0, 5).join(", ")}{s.shared_fields.length > 5 ? "…" : ""}</td>
                  <td className="px-3 py-2 text-xs">{s.rationale}</td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      size="sm"
                      onClick={() => setDraft({ open: true, suggestion: s, tenantSlug: selectedTenant?.slug ?? null })}
                    >
                      <Package className="h-3 w-3 mr-1" />Marketplace plugin
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog open={draft.open} onOpenChange={(o) => setDraft((s) => ({ ...s, open: o }))}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create marketplace plugin</DialogTitle>
          </DialogHeader>
          {draft.suggestion && (
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Plugin name</Label>
                <Input defaultValue={`Consolidated: ${draft.suggestion.recon_a} + ${draft.suggestion.recon_b}`} />
              </div>
              <div>
                <Label className="text-xs">Pre-populated metadata (JSON)</Label>
                <Textarea
                  rows={12}
                  readOnly
                  value={JSON.stringify(buildPluginMetadata(draft.suggestion), null, 2)}
                  className="font-mono text-xs"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    await navigator.clipboard.writeText(
                      JSON.stringify(buildPluginMetadata(draft.suggestion), null, 2),
                    );
                    toast.success("Copied to clipboard");
                  }}
                >
                  <Copy className="h-3 w-3 mr-1" />Copy
                </Button>
                {draft.tenantSlug && (
                  <Button asChild>
                    <Link to="/$slug/tenant/settings/marketplace" params={{ slug: draft.tenantSlug }}>
                      Open marketplace
                    </Link>
                  </Button>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft((s) => ({ ...s, open: false }))}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
