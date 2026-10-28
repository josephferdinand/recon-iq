import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listExceptions, resolveException } from "@/lib/recons.functions";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Smartphone, ChevronLeft, ChevronRight, Check, X } from "lucide-react";
import { toast } from "sonner";

export function MobileTriage({ tenantId }: { tenantId: string }) {
  const [open, setOpen] = useState(false);
  const list = useServerFn(listExceptions);
  const resolve = useServerFn(resolveException);
  const [idx, setIdx] = useState(0);

  const q = useQuery({
    queryKey: ["mobile-triage", tenantId],
    queryFn: () => list({ data: { tenant_id: tenantId, status: "open" } }),
    enabled: open,
  });
  const rows: any[] = q.data ?? [];
  const cur = rows[idx];

  async function act(status: "resolved" | "wont_fix") {
    if (!cur) return;
    await resolve({ data: { id: cur.id, tenant_id: tenantId, status } });
    toast.success(`Marked ${status}`);
    if (idx >= rows.length - 1) setIdx(0); else q.refetch();
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="md:hidden"><Smartphone className="mr-2 h-3.5 w-3.5" /> Mobile triage</Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="h-[85dvh]">
        <SheetHeader><SheetTitle>Mobile triage</SheetTitle></SheetHeader>
        {!cur ? (
          <p className="mt-8 text-center text-sm text-muted-foreground">No open exceptions.</p>
        ) : (
          <div className="mt-4 flex h-full flex-col">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{idx + 1} / {rows.length}</span>
              <Badge variant={cur.severity === "critical" ? "destructive" : "outline"}>{cur.severity}</Badge>
            </div>
            <div className="mt-4 flex-1 overflow-auto rounded border p-4">
              <h3 className="font-semibold">{cur.reason}</h3>
              <pre className="mt-3 whitespace-pre-wrap text-xs text-muted-foreground">{JSON.stringify(cur.payload ?? {}, null, 2)}</pre>
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2">
              <Button variant="outline" size="lg" onClick={() => setIdx((i) => Math.max(0, i - 1))} aria-label="Previous"><ChevronLeft /></Button>
              <Button variant="destructive" size="lg" onClick={() => act("wont_fix")}><X className="mr-1 h-4 w-4" />Won't fix</Button>
              <Button size="lg" onClick={() => act("resolved")}><Check className="mr-1 h-4 w-4" />Resolve</Button>
              <Button variant="outline" size="lg" onClick={() => setIdx((i) => Math.min(rows.length - 1, i + 1))} aria-label="Next"><ChevronRight /></Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
