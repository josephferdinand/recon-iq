// KB approval diff preview — side-by-side title/summary/status + line-level
// body_md diff between the current published article and the proposed change.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getKbApprovalDiff } from "@/lib/kb-approval-diff.functions";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, FilePlus, FileEdit, FileCheck2, Archive } from "lucide-react";

type Line = { kind: "same" | "add" | "del"; text: string };

// Small LCS-based line diff, adequate for markdown bodies up to ~KB_BODY_MAX.
function diffLines(a: string, b: string): Line[] {
  const A = (a ?? "").split("\n");
  const B = (b ?? "").split("\n");
  const n = A.length, m = B.length;
  // DP table for LCS lengths
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: Line[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push({ kind: "same", text: A[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ kind: "del", text: A[i] }); i++; }
    else { out.push({ kind: "add", text: B[j] }); j++; }
  }
  while (i < n) { out.push({ kind: "del", text: A[i++] }); }
  while (j < m) { out.push({ kind: "add", text: B[j++] }); }
  return out;
}

function KindBadge({ kind }: { kind: string }) {
  if (kind === "create") return <Badge className="bg-emerald-600 text-white"><FilePlus className="mr-1 h-3 w-3" />Create</Badge>;
  if (kind === "update") return <Badge className="bg-sky-600 text-white"><FileEdit className="mr-1 h-3 w-3" />Update</Badge>;
  if (kind === "publish") return <Badge className="bg-indigo-600 text-white"><FileCheck2 className="mr-1 h-3 w-3" />Publish</Badge>;
  if (kind === "archive") return <Badge variant="destructive"><Archive className="mr-1 h-3 w-3" />Archive</Badge>;
  return <Badge>{kind}</Badge>;
}

function FieldRow({ label, before, after }: { label: string; before?: string | null; after?: string | null }) {
  const changed = (before ?? "") !== (after ?? "");
  return (
    <div className="grid grid-cols-[6rem_1fr_1fr] items-start gap-2 border-t px-2 py-1 text-xs">
      <div className="pt-0.5 font-medium text-muted-foreground">{label}</div>
      <div className={changed ? "rounded bg-rose-50 px-1.5 py-0.5 text-rose-900 line-through dark:bg-rose-950/40 dark:text-rose-200" : "text-muted-foreground"}>
        {before ?? <span className="italic opacity-60">—</span>}
      </div>
      <div className={changed ? "rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200" : "text-muted-foreground"}>
        {after ?? <span className="italic opacity-60">—</span>}
      </div>
    </div>
  );
}

export function KbApprovalDiff({ tenantId, actionId }: { tenantId: string; actionId: string }) {
  const fetchDiff = useServerFn(getKbApprovalDiff);
  const q = useQuery({
    queryKey: ["kb-approval-diff", tenantId, actionId],
    queryFn: () => fetchDiff({ data: { tenant_id: tenantId, action_id: actionId } }),
  });

  const lines = useMemo(() => {
    const d = q.data;
    if (!d) return [];
    return diffLines(d.current?.body_md ?? "", d.proposed.body_md ?? "");
  }, [q.data]);

  if (q.isLoading) {
    return (
      <div className="flex items-center gap-2 rounded border bg-muted/20 p-3 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading article diff…
      </div>
    );
  }
  if (q.isError || !q.data) {
    return (
      <div className="rounded border bg-rose-50 p-3 text-xs text-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
        Failed to load diff: {(q.error as any)?.message ?? "unknown error"}
      </div>
    );
  }

  const d = q.data;
  const addCount = lines.filter((l) => l.kind === "add").length;
  const delCount = lines.filter((l) => l.kind === "del").length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <KindBadge kind={d.kind} />
        {d.scope && <Badge variant="outline">scope: {d.scope}</Badge>}
        {d.current && <Badge variant="outline">status: {d.current.status}</Badge>}
        {d.kind === "publish" && <Badge variant="secondary">→ {d.proposed.status}</Badge>}
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
          <span className="text-emerald-700">+{addCount}</span> / <span className="text-rose-700">−{delCount}</span>
        </span>
      </div>

      <div className="overflow-hidden rounded border">
        <div className="grid grid-cols-[6rem_1fr_1fr] gap-2 border-b bg-muted/40 px-2 py-1 text-[10px] uppercase text-muted-foreground">
          <div>Field</div>
          <div>Current (published)</div>
          <div>Proposed</div>
        </div>
        <FieldRow label="Title" before={d.current?.title ?? null} after={d.proposed.title} />
        <FieldRow label="Summary" before={d.current?.summary ?? null} after={d.proposed.summary} />
        <FieldRow label="Category" before={d.current?.category_id ?? null} after={d.proposed.category_id} />
        <FieldRow label="Status" before={d.current?.status ?? null} after={d.proposed.status ?? null} />
      </div>

      <div className="overflow-hidden rounded border">
        <div className="flex items-center justify-between border-b bg-muted/40 px-2 py-1 text-[10px] uppercase text-muted-foreground">
          <span>Body diff (markdown)</span>
          <span className="normal-case">{lines.length} line{lines.length === 1 ? "" : "s"}</span>
        </div>
        <ScrollArea className="max-h-72">
          <pre className="whitespace-pre-wrap px-0 py-0 font-mono text-[11px] leading-5">
            {lines.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                No body changes.
              </div>
            ) : (
              lines.map((l, idx) => (
                <div
                  key={idx}
                  className={
                    l.kind === "add"
                      ? "border-l-2 border-emerald-500 bg-emerald-50 px-2 dark:bg-emerald-950/30"
                      : l.kind === "del"
                        ? "border-l-2 border-rose-500 bg-rose-50 px-2 dark:bg-rose-950/30"
                        : "border-l-2 border-transparent px-2 text-muted-foreground"
                  }
                >
                  <span className="mr-2 select-none opacity-60">
                    {l.kind === "add" ? "+" : l.kind === "del" ? "−" : " "}
                  </span>
                  {l.text || "\u00A0"}
                </div>
              ))
            )}
          </pre>
        </ScrollArea>
      </div>
    </div>
  );
}
