import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listRecons } from "@/lib/recons.functions";
import { NRLEditor } from "./nrl-editor";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Wand2 } from "lucide-react";

/**
 * NRLPage — picks a recon definition then mounts the NRL editor for it.
 */
export function NRLPage({ tenantId, canWrite }: { tenantId: string; canWrite: boolean }) {
  const list = useServerFn(listRecons);
  const recons = useQuery({
    queryKey: ["recons", tenantId],
    queryFn: () => list({ data: { tenant_id: tenantId } }),
  });
  const items = (recons.data ?? []) as Array<{ id: string; name: string }>;
  const [defId, setDefId] = useState<string | undefined>();

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Wand2 className="h-4 w-4" /> Natural Rule Language</CardTitle>
          <CardDescription>
            Author Duco-style match rules in plain English. Pick a recon definition to start.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Select value={defId} onValueChange={setDefId}>
            <SelectTrigger className="max-w-md"><SelectValue placeholder="e.g. Demo Bank Nostro USD vs GL — Daily" /></SelectTrigger>
            <SelectContent>
              {items.map((d) => (
                <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>
      {defId && <NRLEditor tenantId={tenantId} definitionId={defId} canWrite={canWrite} />}
    </div>
  );
}
