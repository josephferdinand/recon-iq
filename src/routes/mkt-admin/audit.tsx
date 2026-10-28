import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listMktAuditLog,
  listMktEntityVersions,
  listMktRoleChanges,
  mktAuditActionEnum,
  type MktAuditRow,
} from "@/lib/mkt-audit.functions";
import { assertMktRolesFn } from "@/lib/mkt-admin.functions";
import { MKT_TAB_ROLES } from "@/lib/mkt-admin-roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { exportCsv, exportPdf, exportXlsxCols, type ExportColumn } from "@/lib/export-utils";
import { History, RefreshCcw, ScrollText, Search, User, Download, Package, Shield } from "lucide-react";

export const Route = createFileRoute("/mkt-admin/audit")({
  ssr: false,
  beforeLoad: async () => {
    // Server-side role guard — direct URL access is denied for non-mkt admins.
    await assertMktRolesFn({ data: { allowed: [...MKT_TAB_ROLES.themes, "super_admin"] as never } });
  },
  component: AuditPage,
});

const ENTITY_LABELS: Record<string, string> = {
  homepage_section: "Homepage section",
  site_logo: "Trusted-by logo",
  llm_provider: "LLM provider",
  kb_source: "Knowledge source",
  admin_role: "Admin role",
  chatbot_prompt: "Chatbot prompt",
  appointment_type: "Appointment type",
  site_theme: "Website theme",
  theme_approval: "Theme approval",
  mkt_bootstrap: "Bootstrap",
  lead: "Lead",
};

const ACTION_TONES: Record<string, string> = {
  create: "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border-emerald-500/30",
  update: "bg-blue-500/10 text-blue-800 dark:text-blue-300 border-blue-500/30",
  delete: "bg-red-500/10 text-red-800 dark:text-red-300 border-red-500/30",
  reset: "bg-amber-500/10 text-amber-900 dark:text-amber-200 border-amber-500/30",
  activate: "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border-emerald-500/30",
  schedule: "bg-indigo-500/10 text-indigo-800 dark:text-indigo-300 border-indigo-500/30",
  rollback: "bg-amber-500/10 text-amber-900 dark:text-amber-200 border-amber-500/30",
  archive: "bg-muted text-muted-foreground border-border",
  stepup_success: "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border-emerald-500/30",
  stepup_failed: "bg-red-500/10 text-red-800 dark:text-red-300 border-red-500/30",
  bootstrap_success: "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border-emerald-500/30",
  bootstrap_denied: "bg-red-500/10 text-red-800 dark:text-red-300 border-red-500/30",
  request: "bg-indigo-500/10 text-indigo-800 dark:text-indigo-300 border-indigo-500/30",
  approve: "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border-emerald-500/30",
  reject: "bg-red-500/10 text-red-800 dark:text-red-300 border-red-500/30",
  cancel: "bg-muted text-muted-foreground border-border",
};

const ACTION_OPTIONS = mktAuditActionEnum.options;
type ActionName = typeof ACTION_OPTIONS[number];

const auditCols: ExportColumn<MktAuditRow>[] = [
  { key: "created_at", header: "When" },
  { key: "actor_email", header: "Actor" },
  { key: "entity_type", header: "Entity" },
  { key: "entity_key", header: "Key" },
  { key: "action", header: "Action" },
  { key: "summary", header: "Summary" },
];

function AuditPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold flex items-center gap-2">
          <ScrollText className="h-6 w-6 text-primary" /> Site content audit log
        </h1>
        <p className="text-sm text-muted-foreground max-w-3xl">
          Append-only trail of every change made in the Site admin — who, what,
          when, and full before/after snapshots. Includes MFA step-up
          attempts, bootstrap events, and four-eyes approval decisions.
        </p>
      </div>
      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">All events</TabsTrigger>
          <TabsTrigger value="roles"><Shield className="mr-1 h-4 w-4" /> Role changes</TabsTrigger>
        </TabsList>
        <TabsContent value="all" className="mt-4"><AllEventsTab /></TabsContent>
        <TabsContent value="roles" className="mt-4"><RoleChangesTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function AllEventsTab() {
  const listFn = useServerFn(listMktAuditLog);
  const [filters, setFilters] = useState<{
    entity_type?: string;
    action?: ActionName;
    q?: string;
    actor_email?: string;
    start_at?: string;
    end_at?: string;
  }>({});
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<MktAuditRow | null>(null);
  const [versionsFor, setVersionsFor] = useState<{ entity_type: string; entity_key: string } | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const limit = 100;

  const q = useQuery({
    queryKey: ["mkt", "audit", filters, offset],
    queryFn: () =>
      listFn({
        data: {
          entity_type: filters.entity_type || undefined,
          action: filters.action,
          actor_email: filters.actor_email?.trim() || undefined,
          q: filters.q?.trim() || undefined,
          start_at: filters.start_at ? new Date(filters.start_at).toISOString() : undefined,
          end_at: filters.end_at ? new Date(filters.end_at).toISOString() : undefined,
          limit, offset,
        },
      }),
  });

  const result = q.data ?? { rows: [], total: 0, offset: 0, limit };
  const rows = result.rows;
  const total = result.total;

  const entityTypes = useMemo(
    () => Array.from(new Set(rows.map((r) => r.entity_type))).sort(),
    [rows],
  );
  const selectedRows = rows.filter((r) => checked[r.id]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3">
        <div className="min-w-[220px] flex-1">
          <FilterLabel>Search</FilterLabel>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8" aria-label="Search audit entries" placeholder="summary, key, or email"
              value={filters.q ?? ""}
              onChange={(e) => { setOffset(0); setFilters((f) => ({ ...f, q: e.target.value })); }} />
          </div>
        </div>
        <div className="min-w-[180px]">
          <FilterLabel>Entity type</FilterLabel>
          <Select value={filters.entity_type ?? "__all"} onValueChange={(v) => { setOffset(0); setFilters((f) => ({ ...f, entity_type: v === "__all" ? undefined : v })); }}>
            <SelectTrigger><SelectValue placeholder="All" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">All entities</SelectItem>
              {Object.keys(ENTITY_LABELS).map((k) => (
                <SelectItem key={k} value={k}>{ENTITY_LABELS[k]}</SelectItem>
              ))}
              {entityTypes.filter((t) => !ENTITY_LABELS[t]).map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-[180px]">
          <FilterLabel>Action</FilterLabel>
          <Select value={filters.action ?? "__all"} onValueChange={(v) => { setOffset(0); setFilters((f) => ({ ...f, action: v === "__all" ? undefined : (v as ActionName) })); }}>
            <SelectTrigger><SelectValue placeholder="All" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">All actions</SelectItem>
              {ACTION_OPTIONS.map((a) => (
                <SelectItem key={a} value={a}>{a}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-[160px]">
          <FilterLabel>Actor email contains</FilterLabel>
          <Input aria-label="Actor email contains" value={filters.actor_email ?? ""} onChange={(e) => { setOffset(0); setFilters((f) => ({ ...f, actor_email: e.target.value })); }} />
        </div>
        <div className="min-w-[160px]">
          <FilterLabel>From</FilterLabel>
          <Input aria-label="Audit entries from" type="datetime-local" value={filters.start_at ?? ""} onChange={(e) => { setOffset(0); setFilters((f) => ({ ...f, start_at: e.target.value || undefined })); }} />
        </div>
        <div className="min-w-[160px]">
          <FilterLabel>To</FilterLabel>
          <Input aria-label="Audit entries to" type="datetime-local" value={filters.end_at ?? ""} onChange={(e) => { setOffset(0); setFilters((f) => ({ ...f, end_at: e.target.value || undefined })); }} />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground">
          Showing {rows.length ? offset + 1 : 0}–{offset + rows.length} of {total}
          {selectedRows.length > 0 && ` · ${selectedRows.length} selected`}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => q.refetch()}>
            <RefreshCcw className="mr-2 h-4 w-4" /> Refresh
          </Button>
          <Button variant="outline" size="sm" disabled={rows.length === 0}
            onClick={() => exportCsv(`mkt-audit-${Date.now()}`, auditCols, rows)}>
            <Download className="mr-2 h-4 w-4" /> CSV
          </Button>
          <Button variant="outline" size="sm" disabled={rows.length === 0}
            onClick={() => exportXlsxCols(`mkt-audit-${Date.now()}`, "audit", auditCols, rows)}>
            <Download className="mr-2 h-4 w-4" /> XLSX
          </Button>
          <Button variant="outline" size="sm" disabled={rows.length === 0}
            onClick={() => exportPdf(`mkt-audit-${Date.now()}.pdf`, "Site content audit log", `${rows.length} rows`, auditCols, rows)}>
            <Download className="mr-2 h-4 w-4" /> PDF
          </Button>
          <Button variant="default" size="sm" disabled={selectedRows.length === 0}
            onClick={() => exportAuditZip(selectedRows)}>
            <Package className="mr-2 h-4 w-4" /> Export ZIP ({selectedRows.length})
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-2 py-2 w-8">
                <Checkbox
                  aria-label="Select all audit entries on this page"
                  checked={rows.length > 0 && rows.every((r) => checked[r.id])}
                  onCheckedChange={(v) => {
                    const next = { ...checked };
                    for (const r of rows) next[r.id] = Boolean(v);
                    setChecked(next);
                  }}
                />
              </th>
              <th className="px-3 py-2 text-left">When</th>
              <th className="px-3 py-2 text-left">Actor</th>
              <th className="px-3 py-2 text-left">Entity</th>
              <th className="px-3 py-2 text-left">Action</th>
              <th className="px-3 py-2 text-left">Summary</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {q.isLoading && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">Loading…</td></tr>
            )}
            {!q.isLoading && rows.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">No audit entries match these filters.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border hover:bg-muted/40">
                <td className="px-2 py-2">
                  <Checkbox aria-label={`Select audit entry ${r.summary ?? r.id}`} checked={!!checked[r.id]} onCheckedChange={(v) => setChecked((c) => ({ ...c, [r.id]: Boolean(v) }))} />
                </td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                  {new Date(r.created_at).toLocaleString()}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <User className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="truncate">{r.actor_email ?? r.actor_id ?? "—"}</span>
                  </div>
                  <ActorPermissionsBadges actorContext={r.actor_context} />
                </td>
                <td className="px-3 py-2">
                  <div className="font-medium">{ENTITY_LABELS[r.entity_type] ?? r.entity_type}</div>
                  {r.entity_key && (
                    <div className="text-xs text-muted-foreground truncate max-w-[220px]">{r.entity_key}</div>
                  )}
                </td>
                <td className="px-3 py-2">
                  <Badge variant="outline" className={ACTION_TONES[r.action] ?? ""}>{r.action}</Badge>
                </td>
                <td className="px-3 py-2 text-muted-foreground max-w-[380px] truncate">{r.summary ?? "—"}</td>
                <td className="px-3 py-2 text-right">
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setSelected(r)}>Diff</Button>
                    {r.entity_key && (
                      <Button size="sm" variant="outline" onClick={() => setVersionsFor({ entity_type: r.entity_type, entity_key: r.entity_key! })}>
                        <History className="mr-1 h-3.5 w-3.5" /> History
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs">
        <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>Prev</Button>
        <span className="text-muted-foreground">Page {Math.floor(offset / limit) + 1} of {Math.max(1, Math.ceil(total / limit))}</span>
        <Button variant="outline" size="sm" disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}>Next</Button>
      </div>

      <DiffDialog row={selected} onClose={() => setSelected(null)} />
      <VersionsDialog target={versionsFor} onClose={() => setVersionsFor(null)} />
    </div>
  );
}

function RoleChangesTab() {
  const _nav = useNavigate();
  const listFn = useServerFn(listMktRoleChanges);
  const [range, setRange] = useState<{ start_at?: string; end_at?: string }>({});
  const q = useQuery({
    queryKey: ["mkt", "audit", "roles", range],
    queryFn: () => listFn({ data: {
      start_at: range.start_at ? new Date(range.start_at).toISOString() : undefined,
      end_at: range.end_at ? new Date(range.end_at).toISOString() : undefined,
      limit: 500,
    } }),
  });
  const rows = q.data ?? [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3">
        <div className="min-w-[180px]">
          <FilterLabel>From</FilterLabel>
          <Input aria-label="Role changes from" type="datetime-local" value={range.start_at ?? ""} onChange={(e) => setRange((r) => ({ ...r, start_at: e.target.value || undefined }))} />
        </div>
        <div className="min-w-[180px]">
          <FilterLabel>To</FilterLabel>
          <Input aria-label="Role changes to" type="datetime-local" value={range.end_at ?? ""} onChange={(e) => setRange((r) => ({ ...r, end_at: e.target.value || undefined }))} />
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={() => exportCsv(`mkt-role-changes-${Date.now()}`, auditCols, rows)} disabled={rows.length === 0}>
            <Download className="mr-2 h-4 w-4" /> CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => exportXlsxCols(`mkt-role-changes-${Date.now()}`, "roles", auditCols, rows)} disabled={rows.length === 0}>
            <Download className="mr-2 h-4 w-4" /> XLSX
          </Button>
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">When</th>
              <th className="px-3 py-2 text-left">Actor (who)</th>
              <th className="px-3 py-2 text-left">Action</th>
              <th className="px-3 py-2 text-left">Target (what)</th>
              <th className="px-3 py-2 text-left">Summary</th>
            </tr>
          </thead>
          <tbody>
            {q.isLoading && <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">Loading…</td></tr>}
            {!q.isLoading && rows.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">No role changes in this range.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{new Date(r.created_at).toLocaleString()}</td>
                <td className="px-3 py-2">
                  <div>{r.actor_email ?? r.actor_id ?? "—"}</div>
                  <ActorPermissionsBadges actorContext={r.actor_context} />
                </td>
                <td className="px-3 py-2">
                  <Badge variant="outline" className={ACTION_TONES[r.action] ?? ""}>{r.action}</Badge>
                </td>
                <td className="px-3 py-2 font-mono text-xs">{r.entity_key ?? "—"}</td>
                <td className="px-3 py-2 text-muted-foreground max-w-[420px] truncate">{r.summary ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FilterLabel({ children }: { children: React.ReactNode }) {
  return <label className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">{children}</label>;
}

/** Renders the actor's effective marketing permissions captured at the
 * moment the audited change happened. Falls back gracefully for legacy
 * rows that predate the actor_context column. */
function ActorPermissionsBadges({ actorContext }: { actorContext: string | null }) {
  if (!actorContext) return null;
  let parsed: { roles?: string[]; is_platform_admin?: boolean; source?: string } | null = null;
  try { parsed = JSON.parse(actorContext); } catch { return null; }
  if (!parsed) return null;
  const roles = Array.isArray(parsed.roles) ? parsed.roles : [];
  if (roles.length === 0 && !parsed.is_platform_admin) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {parsed.is_platform_admin && (
        <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary text-[10px]">
          <Shield className="mr-1 h-3 w-3" /> Platform Owner
        </Badge>
      )}
      {roles.map((role) => (
        <Badge key={role} variant="outline" className="bg-muted text-muted-foreground text-[10px]">
          {role}
        </Badge>
      ))}
      {parsed.source && (
        <span className="text-[10px] text-muted-foreground/70">via {parsed.source}</span>
      )}
    </div>
  );
}

function DiffDialog({ row, onClose }: { row: MktAuditRow | null; onClose: () => void }) {
  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Change details</DialogTitle>
          <DialogDescription>{row?.summary ?? "Before / after snapshot."}</DialogDescription>
        </DialogHeader>
        {row && (
          <div className="grid gap-3 md:grid-cols-2">
            <SnapshotBlock title="Before" json={row.before} />
            <SnapshotBlock title="After" json={row.after} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SnapshotBlock({ title, json }: { title: string; json: string | null }) {
  let pretty = "—";
  if (json) {
    try { pretty = JSON.stringify(JSON.parse(json), null, 2); } catch { pretty = json; }
  }
  return (
    <div className="overflow-hidden rounded-md border border-border bg-muted/40">
      <div className="border-b border-border bg-muted px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <pre className="max-h-[420px] overflow-auto p-3 text-xs whitespace-pre-wrap break-words">{pretty}</pre>
    </div>
  );
}

function VersionsDialog({ target, onClose }: { target: { entity_type: string; entity_key: string } | null; onClose: () => void }) {
  const listFn = useServerFn(listMktEntityVersions);
  const q = useQuery({
    enabled: !!target,
    queryKey: ["mkt", "audit", "versions", target?.entity_type, target?.entity_key],
    queryFn: () => listFn({ data: { entity_type: target!.entity_type, entity_key: target!.entity_key, limit: 100 } }),
  });
  const rows = q.data ?? [];
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Version history</DialogTitle>
          <DialogDescription>
            {target ? `${ENTITY_LABELS[target.entity_type] ?? target.entity_type} — ${target.entity_key}` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[520px] space-y-2 overflow-auto">
          {q.isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
          {!q.isLoading && rows.length === 0 && <div className="text-sm text-muted-foreground">No versions recorded yet.</div>}
          {rows.map((r) => (
            <div key={r.id} className="rounded-md border border-border bg-card p-3">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={ACTION_TONES[r.action] ?? ""}>{r.action}</Badge>
                  <span className="font-mono">{new Date(r.created_at).toLocaleString()}</span>
                </div>
                <span>{r.actor_email ?? r.actor_id ?? "—"}</span>
              </div>
              <ActorPermissionsBadges actorContext={r.actor_context} />
              {r.summary && <div className="mt-1 text-sm">{r.summary}</div>}
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-primary hover:underline">Snapshot</summary>
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  <SnapshotBlock title="Before" json={r.before} />
                  <SnapshotBlock title="After" json={r.after} />
                </div>
              </details>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Bundle selected rows into a single ZIP (CSV + JSON + XLSX + PDF-ready HTML). */
async function exportAuditZip(rows: MktAuditRow[]) {
  const JSZip = (await import("jszip")).default;
  const XLSX = await import("xlsx");
  const zip = new JSZip();
  const header = auditCols.map((c) => c.header);
  const body = rows.map((r) => auditCols.map((c) => (r as unknown as Record<string, unknown>)[c.key] ?? ""));

  // CSV
  const csvEsc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [header.map(csvEsc).join(","), ...body.map((r) => r.map(csvEsc).join(","))].join("\n");
  zip.file("audit.csv", csv);

  // JSON
  zip.file("audit.json", JSON.stringify(rows, null, 2));

  // XLSX
  const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "audit");
  const xlsxBuf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  zip.file("audit.xlsx", xlsxBuf);

  // Printable HTML
  const th = header.map((h) => `<th>${h}</th>`).join("");
  const tr = body.map((r) => `<tr>${r.map((c) => `<td>${String(c).replace(/</g,"&lt;")}</td>`).join("")}</tr>`).join("");
  const html = `<!doctype html><meta charset=utf-8><title>Audit export</title>
    <style>body{font:12px system-ui;padding:24px} table{border-collapse:collapse;width:100%} th,td{border:1px solid #ddd;padding:6px}</style>
    <h1>Site audit export</h1><div>${rows.length} rows · ${new Date().toISOString()}</div>
    <table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
  zip.file("audit.html", html);

  // Manifest
  zip.file("MANIFEST.txt",
    `Marketing admin audit export\nGenerated: ${new Date().toISOString()}\nRows: ${rows.length}\nFiles: audit.csv, audit.json, audit.xlsx, audit.html\n`);

  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `mkt-audit-bundle-${Date.now()}.zip`; a.click();
  URL.revokeObjectURL(url);
}
