import { useState, useMemo, useRef, useEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listBreaks, updateBreak, bulkUpdateBreaks, listComments, addComment } from "@/lib/break-manager.functions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { AlertOctagon, Clock, MessageSquare, Tag, User, CheckCircle2, XCircle, Keyboard } from "lucide-react";
import { useKeyboardShortcuts, type Shortcut } from "@/hooks/use-keyboard-shortcuts";
import { KeyboardShortcutsDialog } from "@/components/keyboard-shortcuts-dialog";
import { BreakNotesGrid } from "@/components/break-notes-grid";
import { ExceptionLifecycleDialog } from "@/components/rekon/exception-lifecycle-dialog";

const LIFECYCLE = [
  { key: "new", label: "New", tone: "bg-slate-500" },
  { key: "assigned", label: "Assigned", tone: "bg-blue-500" },
  { key: "investigating", label: "Investigating", tone: "bg-amber-500" },
  { key: "pending_counterparty", label: "Pending CP", tone: "bg-purple-500" },
  { key: "resolved", label: "Resolved", tone: "bg-emerald-600" },
  { key: "written_off", label: "Written off", tone: "bg-zinc-600" },
] as const;

const PRIORITIES = ["P1", "P2", "P3", "P4"] as const;

type BreakDetailRow = {
  id: string;
  reason: string;
  created_at: string;
  lifecycle_state: string;
  priority: string;
  severity: string;
  side: string | null;
  root_cause: string | null;
  payload: unknown;
  status: string;
  run?: { definition?: { name?: string } | null } | null;
};

export function BreakManagerTab({ tenantId, canWrite }: { tenantId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const [view, setView] = useState<"kanban" | "list">("kanban");
  const [q, setQ] = useState("");
  const [priority, setPriority] = useState<string>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [lifecycleId, setLifecycleId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focusIdx, setFocusIdx] = useState(0);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const breaks = useQuery({
    queryKey: ["breaks", tenantId, priority],
    queryFn: () => listBreaks({ data: { tenant_id: tenantId, priority: priority === "all" ? undefined : priority, limit: 300 } }),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });

  const update = useMutation({
    mutationFn: (v: { id: string; patch: any }) => updateBreak({ data: { tenant_id: tenantId, ...v } }),
    onSuccess: () => { toast.success("Updated"); qc.invalidateQueries({ queryKey: ["breaks", tenantId] }); },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  const bulk = useMutation({
    mutationFn: (patch: any) => bulkUpdateBreaks({ data: { tenant_id: tenantId, ids: Array.from(selected), patch } }),
    onSuccess: (r: any) => { toast.success(`Updated ${r.count}`); setSelected(new Set()); qc.invalidateQueries({ queryKey: ["breaks", tenantId] }); },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  const filtered = useMemo(() => {
    const rows = breaks.data ?? [];
    if (!q.trim()) return rows;
    const s = q.toLowerCase();
    return rows.filter((r: any) =>
      (r.reason ?? "").toLowerCase().includes(s) ||
      (r.root_cause ?? "").toLowerCase().includes(s) ||
      (r.run?.definition?.name ?? "").toLowerCase().includes(s)
    );
  }, [breaks.data, q]);

  const grouped = useMemo(() => {
    const g: Record<string, any[]> = {};
    for (const l of LIFECYCLE) g[l.key] = [];
    for (const r of filtered) (g[r.lifecycle_state] ??= []).push(r);
    return g;
  }, [filtered]);

  const toggle = (id: string) => {
    const s = new Set(selected);
    if (s.has(id)) s.delete(id); else s.add(id);
    setSelected(s);
  };

  // Clamp focus when filtered list changes
  useEffect(() => {
    if (focusIdx >= filtered.length) setFocusIdx(Math.max(0, filtered.length - 1));
  }, [filtered.length, focusIdx]);

  const focusedRow = filtered[focusIdx];

  const moveLifecycle = (state: string) => {
    if (selected.size > 0) bulk.mutate({ lifecycle_state: state });
    else if (focusedRow) update.mutate({ id: focusedRow.id, patch: { lifecycle_state: state } });
  };

  const shortcuts: Shortcut[] = [
    { combo: "?", group: "Help", description: "Show keyboard shortcuts", handler: () => setShowShortcuts(true) },
    { combo: "shift+/", group: "Help", description: "Show keyboard shortcuts", handler: () => setShowShortcuts(true) },
    { combo: "/", group: "Navigation", description: "Focus search", handler: () => searchRef.current?.focus() },
    { combo: "esc", group: "Navigation", description: "Close panel / clear selection", allowInInput: true, handler: () => {
      if (openId) setOpenId(null);
      else if (selected.size > 0) setSelected(new Set());
      else (document.activeElement as HTMLElement | null)?.blur?.();
    } },
    { combo: "j", group: "Navigation", description: "Next break", handler: () => setFocusIdx((i) => Math.min(filtered.length - 1, i + 1)) },
    { combo: "k", group: "Navigation", description: "Previous break", handler: () => setFocusIdx((i) => Math.max(0, i - 1)) },
    { combo: "arrowdown", group: "Navigation", description: "Next break", handler: () => setFocusIdx((i) => Math.min(filtered.length - 1, i + 1)) },
    { combo: "arrowup", group: "Navigation", description: "Previous break", handler: () => setFocusIdx((i) => Math.max(0, i - 1)) },
    { combo: "enter", group: "Navigation", description: "Open focused break", handler: () => focusedRow && setOpenId(focusedRow.id) },
    { combo: "x", group: "Selection", description: "Toggle select on focused", handler: () => focusedRow && toggle(focusedRow.id) },
    { combo: "shift+a", group: "Selection", description: "Select all visible", handler: () => setSelected(new Set(filtered.map((r: any) => r.id))) },
    { combo: "shift+n", group: "Selection", description: "Clear selection", handler: () => setSelected(new Set()) },
    { combo: "g", group: "View", description: "Toggle Kanban / List", handler: () => setView((v) => (v === "kanban" ? "list" : "kanban")) },
    ...(canWrite ? ([
      { combo: "1", group: "Lifecycle", description: "Move to New", handler: () => moveLifecycle("new") },
      { combo: "2", group: "Lifecycle", description: "Move to Assigned", handler: () => moveLifecycle("assigned") },
      { combo: "3", group: "Lifecycle", description: "Move to Investigating", handler: () => moveLifecycle("investigating") },
      { combo: "4", group: "Lifecycle", description: "Move to Pending Counterparty", handler: () => moveLifecycle("pending_counterparty") },
      { combo: "5", group: "Lifecycle", description: "Move to Resolved", handler: () => moveLifecycle("resolved") },
      { combo: "r", group: "Lifecycle", description: "Mark resolved", handler: () => moveLifecycle("resolved") },
      { combo: "a", group: "Lifecycle", description: "Accept (mark resolved)", handler: () => moveLifecycle("resolved") },
      { combo: "c", group: "Edit", description: "Focus comment on open break", handler: () => {
        const ta = document.querySelector<HTMLTextAreaElement>('[data-shortcut="break-comment"]');
        ta?.focus();
      } },
    ] as Shortcut[]) : []),
  ];

  // First-use hint: open the shortcuts dialog the very first time a user
  // lands on Break Manager, then never again (localStorage flag).
  useEffect(() => {
    try {
      if (typeof window === "undefined") return;
      if (window.localStorage.getItem("fvi-shortcuts-seen") === "1") return;
      setShowShortcuts(true);
      window.localStorage.setItem("fvi-shortcuts-seen", "1");
    } catch { /* localStorage unavailable */ }
  }, []);

  useKeyboardShortcuts(shortcuts);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input ref={searchRef} placeholder="Search reason, root cause, recon…  (press / to focus)" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <Select value={priority} onValueChange={setPriority}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All priorities</SelectItem>
            {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant={view === "kanban" ? "default" : "outline"} onClick={() => setView("kanban")}>Kanban</Button>
          <Button size="sm" variant={view === "list" ? "default" : "outline"} onClick={() => setView("list")}>List</Button>
          <Button size="sm" variant="ghost" onClick={() => setShowShortcuts(true)} title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts"><Keyboard className="h-4 w-4" /></Button>
        </div>
      </div>

      {canWrite && selected.size > 0 && (
        <Card className="border-primary/40">
          <CardContent className="flex flex-wrap items-center gap-2 py-3">
            <span className="text-sm font-medium">{selected.size} selected</span>
            <Select onValueChange={(v) => bulk.mutate({ lifecycle_state: v })}>
              <SelectTrigger className="w-44"><SelectValue placeholder="e.g. open → investigating → resolved" /></SelectTrigger>
              <SelectContent>{LIFECYCLE.filter((l) => l.key !== "written_off").map((l) => <SelectItem key={l.key} value={l.key}>{l.label}</SelectItem>)}</SelectContent>
            </Select>
            <Select onValueChange={(v) => bulk.mutate({ priority: v })}>
              <SelectTrigger className="w-36"><SelectValue placeholder="e.g. P1 (Demo Bank SLA: 1h) / P2 (4h) / P3 (next day)" /></SelectTrigger>
              <SelectContent>{PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
            </Select>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
          </CardContent>
        </Card>
      )}

      {breaks.isLoading ? (
        <div className="grid gap-3 md:grid-cols-3"><Skeleton className="h-48" /><Skeleton className="h-48" /><Skeleton className="h-48" /></div>
      ) : view === "kanban" ? (
        <div className="grid gap-3 overflow-x-auto pb-2" style={{ gridTemplateColumns: `repeat(${LIFECYCLE.length}, minmax(260px, 1fr))` }}>
          {LIFECYCLE.map((l) => (
            <div key={l.key} className="rounded-lg border bg-muted/30 p-2">
              <div className="mb-2 flex items-center justify-between px-1">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <span className={`h-2 w-2 rounded-full ${l.tone}`} />
                  {l.label}
                </div>
                <Badge variant="outline">{grouped[l.key].length}</Badge>
              </div>
              <div className="space-y-2">
                {grouped[l.key].slice(0, 50).map((b: any) => (
                  <BreakCard key={b.id}
                    row={b}
                    selected={selected.has(b.id)}
                    canWrite={canWrite}
                    onToggle={() => toggle(b.id)}
                    onOpen={() => setOpenId(b.id)}
                    onMove={(state: string) => update.mutate({ id: b.id, patch: { lifecycle_state: state } })}
                  />
                ))}
                {grouped[l.key].length === 0 && <div className="px-2 py-6 text-center text-xs text-muted-foreground">No breaks</div>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <VirtualBreakList
          rows={filtered}
          selected={selected}
          onToggle={toggle}
          onOpen={(id: string) => setOpenId(id)}
        />
      )}

      <BreakDetailSheet
        openId={openId}
        onClose={() => setOpenId(null)}
        tenantId={tenantId}
        canWrite={canWrite}
        row={filtered.find((r: any) => r.id === openId) ?? null}
        onPatch={(patch: any) => openId && update.mutate({ id: openId, patch })}
        onWriteOff={() => { if (openId) setLifecycleId(openId); setOpenId(null); }}
      />
      {lifecycleId && (
        <ExceptionLifecycleDialog
          open
          onOpenChange={(next) => { if (!next) setLifecycleId(null); }}
          tenantId={tenantId}
          exceptionId={lifecycleId}
          currentStatus={filtered.find((row) => row.id === lifecycleId)?.status}
        />
      )}
      <KeyboardShortcutsDialog open={showShortcuts} onOpenChange={setShowShortcuts} shortcuts={shortcuts} title="Break Manager shortcuts" />
    </div>
  );
}

function SeverityChip({ s }: { s: string }) {
  const map: Record<string, string> = {
    low: "bg-muted text-muted-foreground",
    medium: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    high: "bg-orange-500/15 text-orange-700 dark:text-orange-300",
    critical: "bg-red-500/15 text-red-700 dark:text-red-300",
  };
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${map[s] ?? map.medium}`}>{s}</span>;
}

function BreakCard({ row, selected, canWrite, onToggle, onOpen, onMove }: any) {
  return (
    <div className="group rounded-md border bg-card p-2 shadow-sm hover:border-primary/40">
      <div className="flex items-start gap-2">
        <input type="checkbox" checked={selected} onChange={onToggle} className="mt-1" />
        <div className="min-w-0 flex-1 cursor-pointer" onClick={onOpen}>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Badge variant="secondary" className="px-1 text-[10px]">{row.priority}</Badge>
            <SeverityChip s={row.severity} />
            {row.due_date && <span className="ml-auto flex items-center gap-1"><Clock className="h-3 w-3" />{new Date(row.due_date).toLocaleDateString()}</span>}
          </div>
          <div className="mt-1 line-clamp-2 text-sm font-medium">{row.reason}</div>
          <div className="mt-1 text-xs text-muted-foreground">{row.run?.definition?.name ?? "—"}</div>
        </div>
      </div>
      {canWrite && (
        <div className="mt-2 opacity-0 transition group-hover:opacity-100">
          <Select onValueChange={onMove}>
            <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="e.g. move to Demo Bank EMEA family" /></SelectTrigger>
            <SelectContent>{LIFECYCLE.filter((l) => l.key !== "written_off").map((l) => <SelectItem key={l.key} value={l.key}>{l.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}

function BreakDetailSheet({ openId, onClose, tenantId, row, canWrite, onPatch, onWriteOff }: {
  openId: string | null;
  onClose: () => void;
  tenantId: string;
  row: BreakDetailRow | null;
  canWrite: boolean;
  onPatch: (patch: Record<string, unknown>) => void;
  onWriteOff: () => void;
}) {
  const qc = useQueryClient();
  const [comment, setComment] = useState("");
  const [rootCause, setRootCause] = useState("");
  const comments = useQuery({
    queryKey: ["break-comments", openId],
    queryFn: () => listComments({ data: { exception_id: openId } }),
    enabled: !!openId,
  });
  const addC = useMutation({
    mutationFn: () => addComment({ data: { tenant_id: tenantId, exception_id: openId, body: comment, internal: true } }),
    onSuccess: () => { setComment(""); qc.invalidateQueries({ queryKey: ["break-comments", openId] }); },
  });

  return (
    <Sheet open={!!openId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        {row && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2"><AlertOctagon className="h-5 w-5" /> {row.reason}</SheetTitle>
              <SheetDescription>{row.run?.definition?.name ?? "—"} · created {new Date(row.created_at).toLocaleString()}</SheetDescription>
            </SheetHeader>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <Field label="Lifecycle">
                {canWrite ? (
                  <Select value={row.lifecycle_state} onValueChange={(v) => onPatch({ lifecycle_state: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{LIFECYCLE.filter((l) => l.key !== "written_off").map((l) => <SelectItem key={l.key} value={l.key}>{l.label}</SelectItem>)}</SelectContent>
                  </Select>
                ) : <Badge>{row.lifecycle_state}</Badge>}
              </Field>
              <Field label="Priority">
                {canWrite ? (
                  <Select value={row.priority} onValueChange={(v) => onPatch({ priority: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                  </Select>
                ) : <Badge>{row.priority}</Badge>}
              </Field>
              <Field label="Severity"><SeverityChip s={row.severity} /></Field>
              <Field label="Side"><Badge variant="outline">{row.side ?? "—"}</Badge></Field>
            </div>

            <div className="mt-4">
              <div className="text-xs font-medium text-muted-foreground">Root cause</div>
              {canWrite ? (
                <div className="mt-1 flex gap-2">
                  <Input placeholder={row.root_cause ?? "Describe root cause"} value={rootCause} onChange={(e) => setRootCause(e.target.value)} />
                  <Button size="sm" onClick={() => { onPatch({ root_cause: rootCause }); setRootCause(""); }}>Save</Button>
                </div>
              ) : <div className="mt-1 text-sm">{row.root_cause ?? "—"}</div>}
            </div>

            <div className="mt-6">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><MessageSquare className="h-4 w-4" /> Comments</div>
              <div className="space-y-2">
                {(comments.data ?? []).map((c: any) => (
                  <div key={c.id} className="rounded border bg-muted/30 p-2 text-sm">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <User className="h-3 w-3" />
                      <span>{c.author?.full_name ?? c.author?.email ?? "User"}</span>
                      <span>·</span>
                      <span>{new Date(c.created_at).toLocaleString()}</span>
                      {c.internal && <Badge variant="outline" className="ml-auto text-[10px]">internal</Badge>}
                    </div>
                    <div className="mt-1 whitespace-pre-wrap">{c.body}</div>
                  </div>
                ))}
                {(comments.data ?? []).length === 0 && <div className="text-xs text-muted-foreground">No comments yet. Example: “Confirmed with Demo Bank Treasury — FX cut-off difference, reversing T+1.” Example: “Confirmed with Demo Bank Treasury — FX cut-off difference, reversing T+1.”</div>}
              </div>
              {canWrite && (
                <div className="mt-2 flex gap-2">
                  <Textarea data-shortcut="break-comment" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="e.g. Confirmed with Demo Bank Treasury — FX cut-off difference, will reverse T+1" rows={2} />
                  <Button onClick={() => addC.mutate()} disabled={!comment.trim() || addC.isPending}>Post</Button>
                </div>
              )}
            </div>

            <div className="mt-6">
              <BreakNotesGrid tenantId={tenantId} breakId={row.id} canWrite={canWrite} />
            </div>

            <div className="mt-6">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><Tag className="h-4 w-4" /> Payload</div>
              <pre className="overflow-x-auto rounded border bg-muted/40 p-2 text-xs">{JSON.stringify(row.payload, null, 2)}</pre>
            </div>

            {canWrite && (
              <div className="mt-6 flex gap-2">
                <Button variant="default" onClick={() => onPatch({ lifecycle_state: "resolved" })}>
                  <CheckCircle2 className="mr-1 h-4 w-4" /> Resolve
                </Button>
                <Button variant="outline" onClick={onWriteOff}>
                  <XCircle className="mr-1 h-4 w-4" /> Request write-off
                </Button>
              </div>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, children }: any) {
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function VirtualBreakList({ rows, selected, onToggle, onOpen }: {
  rows: any[]; selected: Set<string>; onToggle: (id: string) => void; onOpen: (id: string) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44,
    overscan: 12,
  });

  if (rows.length === 0) {
    return (
      <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">No breaks match your filters.</CardContent></Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <div className="grid grid-cols-[40px_minmax(0,2fr)_minmax(0,1fr)_120px_80px_90px_160px] gap-2 border-b bg-muted/50 px-2 py-2 text-xs uppercase text-muted-foreground">
          <div></div><div>Reason</div><div>Recon</div><div>Lifecycle</div><div>Priority</div><div>Sev</div><div>Created</div>
        </div>
        <div ref={parentRef} style={{ height: 520, overflow: "auto", contain: "strict" }}>
          <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative", width: "100%" }}>
            {rowVirtualizer.getVirtualItems().map((vi) => {
              const b = rows[vi.index];
              return (
                <div
                  key={b.id}
                  className="grid grid-cols-[40px_minmax(0,2fr)_minmax(0,1fr)_120px_80px_90px_160px] gap-2 items-center border-b px-2 text-sm hover:bg-muted/30 cursor-pointer"
                  style={{ position: "absolute", top: 0, left: 0, width: "100%", height: vi.size, transform: `translateY(${vi.start}px)` }}
                  onClick={() => onOpen(b.id)}
                >
                  <div onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(b.id)} onChange={() => onToggle(b.id)} />
                  </div>
                  <div className="truncate">{b.reason}</div>
                  <div className="truncate">{b.run?.definition?.name ?? "—"}</div>
                  <div><Badge variant="outline">{b.lifecycle_state}</Badge></div>
                  <div><Badge>{b.priority}</Badge></div>
                  <div><SeverityChip s={b.severity} /></div>
                  <div className="text-xs text-muted-foreground">{new Date(b.created_at).toLocaleString()}</div>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
