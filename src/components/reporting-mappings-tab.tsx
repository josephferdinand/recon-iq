import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Sparkles, CheckCircle2, Plus } from "lucide-react";
import {
  listReportingMappings, upsertReportingMapping,
  approveReportingMapping, suggestReportingMappings,
} from "@/lib/reporting-mappings.functions";

export function ReportingMappingsTab({ tenantId, canWrite }: { tenantId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const list = useServerFn(listReportingMappings);
  const upsert = useServerFn(upsertReportingMapping);
  const approve = useServerFn(approveReportingMapping);
  const suggest = useServerFn(suggestReportingMappings);

  const [draft, setDraft] = useState({ canonical_field: "", display_label: "", description: "" });

  const q = useQuery({
    queryKey: ["reporting-mappings", tenantId],
    queryFn: () => list({ data: { tenant_id: tenantId } }),
    staleTime: 30_000,
  });

  const mUpsert = useMutation({
    mutationFn: () => upsert({ data: { tenant_id: tenantId, ...draft, source_mappings: [], ai_suggested: false } }),
    onSuccess: () => { toast.success("Mapping saved"); setDraft({ canonical_field: "", display_label: "", description: "" }); qc.invalidateQueries({ queryKey: ["reporting-mappings", tenantId] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const mApprove = useMutation({
    mutationFn: (id: string) => approve({ data: { id, tenant_id: tenantId } }),
    onSuccess: () => { toast.success("Approved"); qc.invalidateQueries({ queryKey: ["reporting-mappings", tenantId] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const mSuggest = useMutation({
    mutationFn: () => suggest({ data: { tenant_id: tenantId } }),
    onSuccess: (rows) => toast.success(`${rows.length} AI suggestions ready`),
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Reporting field mappings</CardTitle>
            <CardDescription>Cross-process semantic layer with maker-checker approval. AI suggests canonical fields from your recon definitions.</CardDescription>
          </div>
          {canWrite ? (
            <Button variant="outline" onClick={() => mSuggest.mutate()} disabled={mSuggest.isPending}>
              <Sparkles className="mr-2 h-4 w-4" /> AI Suggest
            </Button>
          ) : null}
        </CardHeader>
        {canWrite ? (
          <CardContent className="space-y-3 border-t pt-4">
            <div className="grid gap-3 md:grid-cols-3">
              <Input placeholder="e.g. falcon_account_number" value={draft.canonical_field}
                onChange={(e) => setDraft((d) => ({ ...d, canonical_field: e.target.value }))} />
              <Input placeholder="e.g. Demo Bank Nostro USD (Citi)" value={draft.display_label}
                onChange={(e) => setDraft((d) => ({ ...d, display_label: e.target.value }))} />
              <Button onClick={() => mUpsert.mutate()}
                disabled={!draft.canonical_field || !draft.display_label || mUpsert.isPending}>
                <Plus className="mr-2 h-4 w-4" /> Add draft
              </Button>
            </div>
            <Textarea placeholder="e.g. Demo Bank Treasury — daily intercompany sweep reconciliation" rows={2} value={draft.description}
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} />
          </CardContent>
        ) : null}
      </Card>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Canonical field</th>
                <th className="px-4 py-2">Label</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">AI</th>
                <th className="px-4 py-2">v</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(q.data ?? []).map((r: any) => (
                <tr key={r.id} className="border-b">
                  <td className="px-4 py-2 font-mono text-xs">{r.canonical_field}</td>
                  <td className="px-4 py-2">{r.display_label}</td>
                  <td className="px-4 py-2"><Badge variant={r.status === "approved" ? "default" : "outline"}>{r.status}</Badge></td>
                  <td className="px-4 py-2">{r.ai_suggested ? <Badge variant="secondary">{Math.round((r.ai_confidence ?? 0) * 100)}%</Badge> : "—"}</td>
                  <td className="px-4 py-2 text-xs">{r.version}</td>
                  <td className="px-4 py-2 text-right">
                    {canWrite && r.status !== "approved" ? (
                      <Button size="sm" variant="outline" onClick={() => mApprove.mutate(r.id)} disabled={mApprove.isPending}>
                        <CheckCircle2 className="mr-1 h-3 w-3" /> Approve
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
              {q.data && q.data.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No mappings yet. Example: map Citi MT940 :60F: → Demo Bank GL opening_balance. Click AI Suggest to bootstrap.</td></tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
