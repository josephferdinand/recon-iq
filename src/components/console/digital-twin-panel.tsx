/**
 * DigitalTwinPanel — interactive graph of the ops digital twin for the Scale Console.
 *
 * Optimised for large tenants:
 *  - Server-side pagination + filtering via listTwinNodes (offset/limit + type/status/search).
 *  - Server-side aggregation via getTwinStats (RPC get_digital_twin_stats) for tiles.
 *  - TanStack Query caches (30s staleTime + placeholderData) act as the client-side cache.
 *  - Performance tile shows RPC query latency to expose backend health.
 */
import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Network,
  Activity,
  Search,
  X,
  ChevronLeft,
  ChevronRight,
  Gauge,
  GitBranch,
  Clock,
  AlertTriangle,
  AlertCircle,
} from "lucide-react";
import { EmptyStateAction } from "@/components/console-header";
import {
  listTwinNodes,
  getTwinStats,
  getTwinSubgraph,
  rollupTwinStatus,
} from "@/lib/phase8-digital-twin.functions";

type Status = "ok" | "warning" | "breached" | "unknown";
type TwinNode = {
  id: string;
  node_type: string;
  node_key: string;
  label: string;
  status: Status;
  updated_at?: string | null;
};
type SubRow = {
  node_id: string;
  depth: number;
  parent_id: string | null;
  rel: string | null;
  label: string;
  node_type: string;
  status: Status;
};
type TwinStats = {
  total_nodes: number;
  total_edges: number;
  ok_count: number;
  warning_count: number;
  breached_count: number;
  unknown_count: number;
  types: Record<string, number>;
  last_updated: string | null;
  query_ms: number;
};

const TYPES: Array<TwinNode["node_type"]> = [
  "source",
  "cutoff",
  "sla",
  "control",
  "escalation",
  "workflow",
  "recon",
];
const STATUSES: Status[] = ["ok", "warning", "breached", "unknown"];
const PAGE_SIZE = 200;

const STATUS_FILL: Record<Status, string> = {
  ok: "hsl(var(--primary))",
  warning: "hsl(38 92% 55%)",
  breached: "hsl(0 84% 60%)",
  unknown: "hsl(var(--muted-foreground))",
};

export function DigitalTwinPanel({ tenantId }: { tenantId: string }) {
  const ln = useServerFn(listTwinNodes);
  const gs = useServerFn(getTwinSubgraph);
  const gst = useServerFn(getTwinStats);

  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<Status | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<TwinNode | null>(null);
  const [hover, setHover] = useState<TwinNode | null>(null);

  // Debounce the search box → server-side query.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput);
      setPage(0);
    }, 250);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Reset paging when filters change.
  useEffect(() => {
    setPage(0);
  }, [typeFilter, statusFilter]);

  const statsQ = useQuery({
    queryKey: ["twin-stats", tenantId],
    queryFn: () => gst({ data: { tenant_id: tenantId } }),
    staleTime: 30_000,
  });
  const stats = (statsQ.data ?? {
    total_nodes: 0,
    total_edges: 0,
    ok_count: 0,
    warning_count: 0,
    breached_count: 0,
    unknown_count: 0,
    types: {},
    last_updated: null,
    query_ms: 0,
  }) as TwinStats;

  const nodesQ = useQuery({
    queryKey: ["twin-nodes", tenantId, typeFilter, statusFilter, search, page],
    queryFn: () =>
      ln({
        data: {
          tenant_id: tenantId,
          node_type: (typeFilter ?? undefined) as never,
          status: (statusFilter ?? undefined) as never,
          search: search || undefined,
          offset: page * PAGE_SIZE,
          limit: PAGE_SIZE,
        },
      }),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
  const nodeResp = (nodesQ.data ?? { rows: [], total: 0 }) as {
    rows: TwinNode[];
    total: number;
  };
  const nodes = nodeResp.rows;
  const totalMatching = nodeResp.total;
  const pageCount = Math.max(1, Math.ceil(totalMatching / PAGE_SIZE));

  const subQ = useQuery({
    queryKey: ["twin-sub", tenantId, selected?.id],
    queryFn: () =>
      gs({ data: { tenant_id: tenantId, root_node_id: selected!.id, max_depth: 2 } }),
    enabled: !!selected,
    staleTime: 30_000,
  });

  const rollup = useMemo<Status>(() => {
    if (stats.breached_count > 0) return "breached";
    if (stats.warning_count > 0) return "warning";
    if (stats.total_nodes === 0) return "unknown";
    return "ok";
  }, [stats]);
  // rollupTwinStatus retained for callers referencing the pure helper elsewhere.
  void rollupTwinStatus;

  const layout = useMemo(() => layoutNodes(nodes), [nodes]);
  const posById = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    for (const l of layout) m.set(l.node.id, { x: l.x, y: l.y });
    return m;
  }, [layout]);

  const sub = (subQ.data ?? []) as SubRow[];
  const neighbourIds = useMemo(() => new Set(sub.map((r) => r.node_id)), [sub]);
  const edgesForSvg = useMemo(
    () =>
      sub
        .filter((r) => r.parent_id && posById.has(r.parent_id) && posById.has(r.node_id))
        .map((r) => ({
          from: posById.get(r.parent_id!)!,
          to: posById.get(r.node_id)!,
          rel: r.rel ?? "",
        })),
    [sub, posById],
  );

  if (statsQ.isLoading) return <Skeleton className="h-96 w-full mt-4" />;

  if (stats.total_nodes === 0) {
    return (
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Digital twin of operations</CardTitle>
          <CardDescription>
            Sources, cutoffs, SLAs, controls and escalations modelled as a live graph.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EmptyStateAction
            title="No twin nodes for this tenant yet"
            description="Hydrate the digital twin by registering sources, cutoffs, SLAs and controls via upsertTwinNode / upsertTwinEdge."
            actions={[{ label: "Twin API docs", href: "/docs/89_digital_twin.md" }]}
          />
        </CardContent>
      </Card>
    );
  }

  const clearFilters = () => {
    setTypeFilter(null);
    setStatusFilter(null);
    setSearchInput("");
    setSearch("");
    setPage(0);
  };
  const hasFilter = typeFilter || statusFilter || search;

  return (
    <div className="space-y-4 pt-4">
      {/* Performance tiles — server-aggregated */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <MetricTile label="Nodes" value={stats.total_nodes.toLocaleString()} icon={Network} />
        <MetricTile label="Edges" value={stats.total_edges.toLocaleString()} icon={GitBranch} />
        <MetricTile
          label="Breached"
          value={stats.breached_count.toLocaleString()}
          icon={AlertCircle}
          tone={stats.breached_count > 0 ? "danger" : "positive"}
        />
        <MetricTile
          label="Warning"
          value={stats.warning_count.toLocaleString()}
          icon={AlertTriangle}
          tone={stats.warning_count > 0 ? "warning" : "positive"}
        />
        <MetricTile
          label="Last update"
          value={stats.last_updated ? relativeTime(stats.last_updated) : "—"}
          icon={Clock}
          hint={stats.last_updated ? new Date(stats.last_updated).toLocaleString() : ""}
        />
        <MetricTile
          label="Stats query"
          value={`${stats.query_ms} ms`}
          icon={Gauge}
          tone={stats.query_ms < 150 ? "positive" : stats.query_ms < 500 ? "warning" : "danger"}
          hint="server-side aggregate latency"
        />
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Network className="h-4 w-4" />
                Digital twin graph
                <Badge
                  variant="outline"
                  className={
                    rollup === "ok"
                      ? "border-emerald-500/40 text-emerald-600"
                      : rollup === "warning"
                      ? "border-amber-500/40 text-amber-600"
                      : rollup === "breached"
                      ? "border-rose-500/40 text-rose-600"
                      : ""
                  }
                >
                  {rollup}
                </Badge>
                {nodesQ.isFetching && (
                  <Badge variant="outline" className="text-[10px] text-muted-foreground">
                    fetching…
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                {stats.total_nodes.toLocaleString()} tenant nodes across{" "}
                {Object.keys(stats.types).length} types · showing{" "}
                {nodes.length.toLocaleString()} of {totalMatching.toLocaleString()} matching.
                Click a node to expand its 2-hop subgraph.
              </CardDescription>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
              {STATUSES.map((s) => (
                <span key={s} className="inline-flex items-center gap-1">
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ background: STATUS_FILL[s] }}
                  />
                  {s} · {(stats[`${s}_count` as const] as number).toLocaleString()}
                </span>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search label or key"
                aria-label="Search nodes" className="pl-7 h-8 w-56 text-xs"
              />
            </div>
            {hasFilter ? (
              <Button size="sm" variant="ghost" className="h-7" onClick={clearFilters}>
                <X className="h-3.5 w-3.5 mr-1" /> clear
              </Button>
            ) : null}
            <div className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
              <Button
                size="sm"
                variant="outline"
                className="h-7 w-7 p-0"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                aria-label="Previous page"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <span>
                page {page + 1} / {pageCount}
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-7 w-7 p-0"
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                disabled={page >= pageCount - 1}
                aria-label="Next page"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <span className="text-[11px] text-muted-foreground self-center mr-1">type:</span>
            <Button
              size="sm"
              variant={typeFilter === null ? "default" : "outline"}
              onClick={() => setTypeFilter(null)}
              className="h-7"
            >
              all · {stats.total_nodes.toLocaleString()}
            </Button>
            {TYPES.filter((t) => stats.types[t]).map((t) => (
              <Button
                key={t}
                size="sm"
                variant={typeFilter === t ? "default" : "outline"}
                onClick={() => setTypeFilter(typeFilter === t ? null : t)}
                className="h-7"
              >
                {t} · {stats.types[t]?.toLocaleString()}
              </Button>
            ))}
          </div>

          <div className="flex flex-wrap gap-1.5">
            <span className="text-[11px] text-muted-foreground self-center mr-1">status:</span>
            <Button
              size="sm"
              variant={statusFilter === null ? "default" : "outline"}
              onClick={() => setStatusFilter(null)}

              className="h-7"
            >
              any
            </Button>
            {STATUSES.map((s) => (
              <Button
                key={s}
                size="sm"
                variant={statusFilter === s ? "default" : "outline"}
                onClick={() => setStatusFilter(statusFilter === s ? null : s)}
                className="h-7"
                disabled={(stats[`${s}_count` as const] as number) === 0}
              >
                <span
                  className="inline-block h-2 w-2 rounded-full mr-1.5"
                  style={{ background: STATUS_FILL[s] }}
                />
                {s} · {(stats[`${s}_count` as const] as number).toLocaleString()}
              </Button>
            ))}
          </div>

          <div className="rounded-lg border bg-muted/20 overflow-hidden relative">
            <svg viewBox="0 0 640 380" className="w-full h-[360px]">
              <defs>
                <marker
                  id="twin-arrow"
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="hsl(var(--primary))" />
                </marker>
              </defs>

              {edgesForSvg.map((e, i) => (
                <line
                  key={i}
                  x1={e.from.x}
                  y1={e.from.y}
                  x2={e.to.x}
                  y2={e.to.y}
                  stroke="hsl(var(--primary))"
                  strokeOpacity={0.55}
                  strokeWidth={1.2}
                  markerEnd="url(#twin-arrow)"
                />
              ))}

              {layout.map(({ node, x, y }) => {
                const isSelected = selected?.id === node.id;
                const isNeighbour = !!selected && neighbourIds.has(node.id) && !isSelected;
                const dimmed = !!selected && !isSelected && !isNeighbour;
                return (
                  <g
                    key={node.id}
                    transform={`translate(${x},${y})`}
                    className="cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary rounded-full" role="button" tabIndex={0} aria-label={`${node.label} (${node.status})`} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(isSelected ? null : node); } }}
                    opacity={dimmed ? 0.35 : 1}
                    onMouseEnter={() => setHover(node)}
                    onMouseLeave={() => setHover((h) => (h?.id === node.id ? null : h))}
                    onClick={() => setSelected(isSelected ? null : node)}
                  >
                    <circle
                      r={isSelected ? 11 : isNeighbour ? 9 : 7}
                      fill={STATUS_FILL[node.status] ?? STATUS_FILL.unknown}
                      stroke={
                        isSelected
                          ? "hsl(var(--primary))"
                          : isNeighbour
                          ? "hsl(var(--primary))"
                          : "hsl(var(--border))"
                      }
                      strokeWidth={isSelected ? 2.5 : isNeighbour ? 1.5 : 1}
                      opacity={0.95}
                    />
                    <text
                      y={-13}
                      textAnchor="middle"
                      className="fill-foreground pointer-events-none"
                      style={{ fontSize: 9 }}
                    >
                      {node.label.slice(0, 20)}
                    </text>
                  </g>
                );
              })}
            </svg>
            {hover && (
              <div className="absolute bottom-2 left-2 rounded border bg-popover text-popover-foreground shadow px-2 py-1 text-[11px] pointer-events-none">
                <span className="font-medium">{hover.label}</span>{" "}
                <span className="text-muted-foreground">
                  · {hover.node_type} · {hover.status}
                </span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {selected && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base flex-wrap">
              <Activity className="h-4 w-4" />
              {selected.label}
              <Badge variant="outline">{selected.node_type}</Badge>
              <Badge
                variant="outline"
                style={{
                  borderColor: STATUS_FILL[selected.status],
                  color: STATUS_FILL[selected.status],
                }}
              >
                {selected.status}
              </Badge>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 ml-auto"
                onClick={() => setSelected(null)}
              >
                <X className="h-3.5 w-3.5 mr-1" /> close
              </Button>
            </CardTitle>
            <CardDescription>
              key: <code>{selected.node_key}</code>
              {selected.updated_at
                ? ` · updated ${new Date(selected.updated_at).toLocaleString()}`
                : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {subQ.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : sub.length <= 1 ? (
              <p className="text-sm text-muted-foreground">
                No outbound edges from this node yet.
              </p>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  {sub.length - 1} reachable neighbours within 2 hops
                </p>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="py-1">Hop</th>
                      <th>Relation</th>
                      <th>Node</th>
                      <th>Type</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sub
                      .filter((r) => r.node_id !== selected.id)
                      .sort((a, b) => a.depth - b.depth)
                      .map((r) => {
                        const target = nodes.find((n) => n.id === r.node_id);
                        return (
                          <tr key={r.node_id + (r.parent_id ?? "")} className="border-t">
                            <td className="py-1 font-mono">{r.depth}</td>
                            <td>
                              <Badge variant="outline" className="text-[10px]">
                                {r.rel ?? "—"}
                              </Badge>
                            </td>
                            <td>
                              <button
                                className="underline-offset-2 hover:underline text-left"
                                onClick={() => target && setSelected(target)}
                              >
                                {r.label}
                              </button>
                            </td>
                            <td className="text-muted-foreground">{r.node_type}</td>
                            <td>
                              <span
                                className="inline-block h-2 w-2 rounded-full mr-1"
                                style={{ background: STATUS_FILL[r.status] }}
                              />
                              {r.status}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function layoutNodes(
  nodes: TwinNode[],
): Array<{ node: TwinNode; x: number; y: number }> {
  const groups = new Map<string, TwinNode[]>();
  for (const n of nodes) {
    const arr = groups.get(n.node_type) ?? [];
    arr.push(n);
    groups.set(n.node_type, arr);
  }
  const groupKeys = Array.from(groups.keys());
  const cx = 320;
  const cy = 190;
  const out: Array<{ node: TwinNode; x: number; y: number }> = [];
  groupKeys.forEach((gk, gi) => {
    const groupAngle = (gi / Math.max(groupKeys.length, 1)) * Math.PI * 2;
    const gcx = cx + Math.cos(groupAngle) * 150;
    const gcy = cy + Math.sin(groupAngle) * 120;
    const arr = groups.get(gk)!;
    arr.forEach((n, i) => {
      const r = 20 + Math.min(55, arr.length * 4);
      const a = (i / Math.max(arr.length, 1)) * Math.PI * 2;
      out.push({ node: n, x: gcx + Math.cos(a) * r, y: gcy + Math.sin(a) * r });
    });
  });
  return out;
}

function MetricTile({
  label,
  value,
  icon: Icon,
  tone,
  hint,
}: {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "positive" | "warning" | "danger";
  hint?: string;
}) {
  const toneClass =
    tone === "positive"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "warning"
      ? "text-amber-600 dark:text-amber-400"
      : tone === "danger"
      ? "text-rose-600 dark:text-rose-400"
      : "text-foreground";
  return (
    <div className="rounded-md border bg-card p-3" title={hint}>
      <div className="flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <p className={`text-lg font-semibold mt-1 ${toneClass}`}>{value}</p>
    </div>
  );
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diff = Date.now() - then;
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}
