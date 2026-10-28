import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listBrandHistoryAdmin } from "@/lib/mkt-brand.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/mkt-admin/brand/history")({
  component: BrandHistoryPage,
});

function BrandHistoryPage() {
  const fn = useServerFn(listBrandHistoryAdmin);
  const q = useQuery({ queryKey: ["mkt","brand","history"], queryFn: () => fn({ data: { limit: 200 } }) });
  const rows = (q.data ?? []) as Array<{ id: string; entity: string; action: string; actor_email: string | null; notes: string | null; created_at: string }>;
  return (
    <Card className="p-6">
      <h2 className="mb-4 font-semibold">Brand history & audit</h2>
      {q.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No brand changes recorded yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr><th className="py-2 pr-3">When</th><th className="pr-3">Entity</th><th className="pr-3">Action</th><th className="pr-3">Actor</th><th>Notes</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border/60">
                  <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="pr-3"><Badge variant="secondary">{r.entity}</Badge></td>
                  <td className="pr-3"><Badge>{r.action}</Badge></td>
                  <td className="pr-3">{r.actor_email ?? "—"}</td>
                  <td className="text-muted-foreground">{r.notes ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
