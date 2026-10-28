import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getAidpExtractionTimeline } from "@/lib/aidp.functions";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Bot, Check, UserCheck, UserX, Clock, AlertTriangle, FileText, Upload,
  ShieldCheck, GitCommit, Hash, Fingerprint,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  tenantId: string;
  documentId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type Decision = "pending" | "auto_accepted" | "human_accepted" | "human_rejected" | "expired";

const DECISION_META: Record<Decision, { label: string; icon: React.ComponentType<{ className?: string }>; tone: string }> = {
  pending:         { label: "Pending review",   icon: Clock,      tone: "text-amber-600 bg-amber-50 border-amber-200 dark:bg-amber-950/40 dark:border-amber-900" },
  auto_accepted:   { label: "Auto-accepted",    icon: Bot,        tone: "text-emerald-600 bg-emerald-50 border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-900" },
  human_accepted:  { label: "Human accepted",   icon: UserCheck,  tone: "text-blue-600 bg-blue-50 border-blue-200 dark:bg-blue-950/40 dark:border-blue-900" },
  human_rejected:  { label: "Human rejected",   icon: UserX,      tone: "text-rose-600 bg-rose-50 border-rose-200 dark:bg-rose-950/40 dark:border-rose-900" },
  expired:         { label: "Expired",          icon: AlertTriangle, tone: "text-zinc-600 bg-zinc-100 border-zinc-200 dark:bg-zinc-900 dark:border-zinc-800" },
};

function formatActor(actors: Record<string, { email: string | null; full_name: string | null }>, id?: string | null) {
  if (!id) return "System";
  const a = actors[id];
  if (!a) return id.slice(0, 8);
  return a.full_name || a.email || id.slice(0, 8);
}

function fmt(ts: string | null | undefined) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

function actionLabel(a: string) {
  switch (a) {
    case "aidp.extract": return "Extraction completed";
    case "aidp.approve": return "Document approved";
    case "aidp.reject":  return "Document rejected";
    default: return a;
  }
}

export function ExtractionAuditTimeline({ tenantId, documentId, open, onOpenChange }: Props) {
  const fetcher = useServerFn(getAidpExtractionTimeline);
  const q = useQuery({
    queryKey: ["aidp-timeline", tenantId, documentId],
    queryFn: () => fetcher({ data: { tenant_id: tenantId, document_id: documentId! } }),
    enabled: open && !!documentId,
  });

  const timeline = useMemo(() => {
    if (!q.data) return [];
    const items: Array<{
      kind: "upload" | "audit" | "prediction" | "decision" | "output" | "supersede";
      at: string;
      payload: any;
    }> = [];

    if (q.data.document) {
      items.push({ kind: "upload", at: q.data.document.created_at, payload: q.data.document });
    }
    q.data.audit.forEach((a: any) => items.push({ kind: "audit", at: a.occurred_at, payload: a }));
    q.data.predictions.forEach((p: any) => {
      items.push({ kind: "prediction", at: p.created_at, payload: p });
      if (p.decided_at) items.push({ kind: "decision", at: p.decided_at, payload: p });
    });
    q.data.outputs.forEach((o: any) => {
      items.push({ kind: o.supersedes_id ? "supersede" : "output", at: o.generated_at, payload: o });
    });

    return items.sort((a, b) => +new Date(a.at) - +new Date(b.at));
  }, [q.data]);

  const doc = q.data?.document;
  const actors = q.data?.actors ?? {};

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-hidden p-0">
        <div className="flex h-full flex-col">
          <SheetHeader className="border-b px-6 py-4">
            <SheetTitle className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" />
              Extraction audit timeline
            </SheetTitle>
            <SheetDescription>
              Full traceability of every decision, decider, and SHA-256 hash for this document.
            </SheetDescription>
          </SheetHeader>

          {doc ? (
            <div className="border-b bg-muted/30 px-6 py-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 truncate">
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate font-medium">{doc.original_filename}</span>
                </div>
                <Badge variant="outline" className="capitalize">{doc.status}</Badge>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>{doc.mime}</span>
                <span>{(doc.bytes / 1024).toFixed(1)} KB</span>
                {doc.model ? <span>Model: {doc.model}</span> : null}
                {doc.confidence != null ? <span>Confidence: {(Number(doc.confidence) * 100).toFixed(0)}%</span> : null}
                {doc.cost_usd != null ? <span>Cost: ${Number(doc.cost_usd).toFixed(4)}</span> : null}
              </div>
            </div>
          ) : null}

          <ScrollArea className="flex-1">
            <div className="px-6 py-4">
              {q.isLoading ? (
                <div className="py-12 text-center text-sm text-muted-foreground">Loading timeline…</div>
              ) : timeline.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">No timeline events yet.</div>
              ) : (
                <ol className="relative space-y-4 border-l pl-6">
                  {timeline.map((item, i) => (
                    <TimelineRow key={i} item={item} actors={actors} />
                  ))}
                </ol>
              )}
            </div>
          </ScrollArea>

          <div className="border-t bg-muted/20 px-6 py-3 text-xs text-muted-foreground">
            Audit rows are hash-chained (SHA-256) and append-only. Anchored daily for tamper evidence.
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function TimelineRow({
  item, actors,
}: {
  item: { kind: string; at: string; payload: any };
  actors: Record<string, { email: string | null; full_name: string | null }>;
}) {
  const at = fmt(item.at);

  if (item.kind === "upload") {
    return (
      <li className="relative">
        <Dot icon={Upload} tone="text-primary bg-primary/10 border-primary/30" />
        <div className="text-sm font-medium">Document uploaded</div>
        <div className="text-xs text-muted-foreground">{at} · by {formatActor(actors, item.payload.created_by)}</div>
      </li>
    );
  }

  if (item.kind === "audit") {
    const p = item.payload;
    return (
      <li className="relative">
        <Dot icon={GitCommit} tone="text-muted-foreground bg-muted border-border" />
        <div className="text-sm font-medium">{actionLabel(p.action)}</div>
        <div className="text-xs text-muted-foreground">{at} · by {formatActor(actors, p.actor_user_id)}</div>
        {p.row_hash ? (
          <div className="mt-1 flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
            <Hash className="h-3 w-3" />
            {String(p.row_hash).slice(0, 24)}…
          </div>
        ) : null}
      </li>
    );
  }

  if (item.kind === "prediction") {
    const p = item.payload;
    return (
      <li className="relative">
        <Dot icon={Bot} tone="text-indigo-600 bg-indigo-50 border-indigo-200 dark:bg-indigo-950/40 dark:border-indigo-900" />
        <div className="text-sm font-medium">Model prediction</div>
        <div className="text-xs text-muted-foreground">
          {at} · {p.model ?? "model"} · confidence {p.confidence != null ? `${(Number(p.confidence) * 100).toFixed(0)}%` : "—"}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <Badge variant="outline" className={cn("text-[10px]", DECISION_META[p.decision as Decision]?.tone)}>
            {DECISION_META[p.decision as Decision]?.label ?? p.decision}
          </Badge>
          {p.expires_at ? (
            <span className="text-[10px] text-muted-foreground">
              expires {fmt(p.expires_at)}
            </span>
          ) : null}
        </div>
      </li>
    );
  }

  if (item.kind === "decision") {
    const p = item.payload;
    const meta = DECISION_META[p.decision as Decision] ?? DECISION_META.pending;
    const Icon = meta.icon;
    return (
      <li className="relative">
        <Dot icon={Icon} tone={meta.tone} />
        <div className="text-sm font-medium">{meta.label}</div>
        <div className="text-xs text-muted-foreground">
          {at} · by {formatActor(actors, p.decided_by)}
        </div>
        <div className="mt-1 font-mono text-[10px] text-muted-foreground">
          prediction {String(p.id).slice(0, 8)}
        </div>
      </li>
    );
  }

  if (item.kind === "output" || item.kind === "supersede") {
    const o = item.payload;
    const value = o.value_text ?? o.value_number ?? o.value_date ?? "—";
    return (
      <li className="relative">
        <Dot
          icon={item.kind === "supersede" ? Fingerprint : Check}
          tone={item.kind === "supersede"
            ? "text-amber-600 bg-amber-50 border-amber-200 dark:bg-amber-950/40 dark:border-amber-900"
            : "text-emerald-600 bg-emerald-50 border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-900"}
        />
        <div className="text-sm font-medium">
          {item.kind === "supersede" ? "Output corrected" : "Output published"}
        </div>
        <div className="text-xs text-muted-foreground">
          {at} · by {formatActor(actors, o.generated_by)} · origin {o.origin}
        </div>
        <div className="mt-1 truncate font-mono text-xs">
          value: {String(value)}
          {o.confidence != null ? ` · ${(Number(o.confidence) * 100).toFixed(0)}%` : ""}
        </div>
        {item.kind === "supersede" ? (
          <div className="text-[10px] text-muted-foreground">supersedes {String(o.supersedes_id).slice(0, 8)}</div>
        ) : null}
      </li>
    );
  }

  return null;
}

function Dot({ icon: Icon, tone }: { icon: React.ComponentType<{ className?: string }>; tone: string }) {
  return (
    <span
      className={cn(
        "absolute -left-[34px] top-0 flex h-7 w-7 items-center justify-center rounded-full border",
        tone,
      )}
    >
      <Icon className="h-3.5 w-3.5" />
    </span>
  );
}

// re-export for separator usage
export { Separator };
