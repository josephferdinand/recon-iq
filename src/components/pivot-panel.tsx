import { useMemo, useState, type ReactElement } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronDown, ChevronRight, GroupIcon, Sigma, X } from "lucide-react";

export type PivotConfig = {
  rowFields: string[];
  colField?: string | null;
  valueField?: string | null;
  agg?: "sum" | "avg" | "count" | "min" | "max";
};

export interface PivotPanelProps {
  rows: Record<string, any>[];
  fields: { key: string; label: string; type?: "string" | "number" | "date" }[];
  config: PivotConfig;
  onConfigChange: (c: PivotConfig) => void;
  totalLabel?: string;
}

function numericValues(rows: Record<string, any>[], field: string): number[] {
  return rows.flatMap((row) => {
    const value = row[field];
    if (typeof value === "number") return Number.isFinite(value) ? [value] : [];
    if (typeof value !== "string" || !value.trim()) return [];
    const parsed = Number(value);
    return Number.isFinite(parsed) ? [parsed] : [];
  });
}

function aggregate(values: number[], agg: PivotConfig["agg"]): number | null {
  if (!values.length) return agg === "count" ? 0 : null;
  switch (agg) {
    case "avg": return values.reduce((a, b) => a + b, 0) / values.length;
    case "count": return values.length;
    case "min": return Math.min(...values);
    case "max": return Math.max(...values);
    default: return values.reduce((a, b) => a + b, 0);
  }
}

export function PivotPanel({ rows, fields, config, onConfigChange, totalLabel = "Grand total" }: PivotPanelProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const numericFields = fields.filter((f) => f.type === "number");

  const grouped = useMemo(() => {
    const map = new Map<string, { key: string; depth: number; rows: Record<string, any>[]; subgroups?: Map<string, any> }>();

    function buildTree(items: Record<string, any>[], depth: number): Map<string, any> {
      const field = config.rowFields[depth];
      const branch = new Map<string, any>();
      if (!field) return branch;
      const groups = new Map<string, Record<string, any>[]>();
      for (const r of items) {
        const k = String(r[field] ?? "—");
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k)!.push(r);
      }
      for (const [k, v] of groups) {
        branch.set(k, {
          rows: v,
          children: depth + 1 < config.rowFields.length ? buildTree(v, depth + 1) : null,
        });
      }
      return branch;
    }

    const tree = buildTree(rows, 0);
    return tree;
  }, [rows, config.rowFields]);

  const colValues = useMemo(() => {
    if (!config.colField) return [] as string[];
    return Array.from(new Set(rows.map((r) => String(r[config.colField!] ?? "—")))).sort();
  }, [rows, config.colField]);

  const renderRows = (tree: Map<string, any>, depth: number, parentKey: string): ReactElement[] => {
    const out: ReactElement[] = [];
    for (const [k, node] of tree) {
      const fullKey = `${parentKey}/${k}`;
      const isCollapsed = collapsed.has(fullKey);
      const rowVals = config.valueField ? numericValues(node.rows, config.valueField) : [];
      out.push(
        <tr key={fullKey} className="border-b hover:bg-muted/40">
          <td className="px-3 py-1.5" style={{ paddingLeft: `${depth * 16 + 12}px` }}>
            <button
              className="inline-flex items-center gap-1 text-sm font-medium"
              aria-expanded={node.children ? !isCollapsed : undefined}
              aria-label={node.children ? "Toggle " + k + " group" : undefined}
              onClick={() => {
                setCollapsed((s) => { const n = new Set(s); n.has(fullKey) ? n.delete(fullKey) : n.add(fullKey); return n; });
              }}
            >
              {node.children ? (isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />) : <span className="w-3" />}
              <span>{k}</span>
              <Badge variant="outline" className="ml-1 text-[10px]">{node.rows.length}</Badge>
            </button>
          </td>
          {colValues.length === 0 ? (
            <td className="px-3 py-1.5 text-right font-mono text-sm">
              {config.valueField ? formatAggregate(aggregate(rowVals, config.agg)) : node.rows.length}
            </td>
          ) : (
            colValues.map((cv) => {
              const subset = node.rows.filter((r: any) => String(r[config.colField!] ?? "—") === cv);
              const v = config.valueField ? aggregate(numericValues(subset, config.valueField), config.agg) : subset.length;
              return (
                <td key={cv} className="px-3 py-1.5 text-right font-mono text-sm">
                  {formatAggregate(v)}
                </td>
              );
            })
          )}
        </tr>,
      );
      if (node.children && !isCollapsed) out.push(...renderRows(node.children, depth + 1, fullKey));
    }
    return out;
  };

  const totalRow = useMemo(() => {
    if (!config.valueField) return rows.length;
    const vals = numericValues(rows, config.valueField);
    return aggregate(vals, config.agg);
  }, [rows, config]);

  function formatAggregate(value: number | null): string {
    return value == null ? "—" : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <GroupIcon className="h-4 w-4 text-primary" /> Pivot / Group-by
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Group rows by</label>
            <div className="flex flex-wrap gap-1">
              {config.rowFields.map((f) => (
                <Badge key={f} variant="secondary" className="gap-1">
                  {fields.find((x) => x.key === f)?.label ?? f}
                  <button
                    aria-label={"Remove " + (fields.find((x) => x.key === f)?.label ?? f) + " row grouping"}
                    onClick={() => onConfigChange({ ...config, rowFields: config.rowFields.filter((x) => x !== f) })}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
              <Select value="" onValueChange={(v) => v && onConfigChange({ ...config, rowFields: [...config.rowFields, v] })}>
                <SelectTrigger className="h-7 w-32 text-xs"><SelectValue placeholder="+ Add field" /></SelectTrigger>
                <SelectContent>
                  {fields.filter((f) => !config.rowFields.includes(f.key)).map((f) => (
                    <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Pivot columns by</label>
            <Select value={config.colField ?? "__none__"} onValueChange={(v) => onConfigChange({ ...config, colField: v === "__none__" ? null : v })}>
              <SelectTrigger className="h-7 w-40 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— None —</SelectItem>
                {fields.map((f) => (<SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Value</label>
            <Select value={config.valueField ?? "__count__"} onValueChange={(v) => onConfigChange({ ...config, valueField: v === "__count__" ? null : v })}>
              <SelectTrigger className="h-7 w-40 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__count__">Count of rows</SelectItem>
                {numericFields.map((f) => (<SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Aggregate</label>
            <Select value={config.agg ?? "sum"} onValueChange={(v) => onConfigChange({ ...config, agg: v as any })}>
              <SelectTrigger className="h-7 w-28 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="sum">Sum</SelectItem>
                <SelectItem value="avg">Average</SelectItem>
                <SelectItem value="count">Count</SelectItem>
                <SelectItem value="min">Min</SelectItem>
                <SelectItem value="max">Max</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button variant="outline" size="sm" onClick={() => onConfigChange({ rowFields: [], colField: null, valueField: null, agg: "sum" })}>
            Reset
          </Button>
        </div>

        <div className="border rounded-md overflow-auto max-h-[60vh]">
          <table className="w-full text-sm">
            <thead className="bg-muted sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold">
                  {config.rowFields.length ? config.rowFields.map((f) => fields.find((x) => x.key === f)?.label ?? f).join(" / ") : "Group"}
                </th>
                {colValues.length === 0 ? (
                  <th className="px-3 py-2 text-right text-xs font-semibold">
                    <Sigma className="inline h-3 w-3 mr-1" />
                    {config.valueField ? `${config.agg ?? "sum"}(${fields.find((x) => x.key === config.valueField)?.label})` : "Count"}
                  </th>
                ) : (
                  colValues.map((cv) => (
                    <th key={cv} className="px-3 py-2 text-right text-xs font-semibold">{cv}</th>
                  ))
                )}
              </tr>
            </thead>
            <tbody>
              {config.rowFields.length === 0 ? (
                <tr><td colSpan={1 + Math.max(1, colValues.length)} className="px-3 py-8 text-center text-muted-foreground text-sm">
                  Drag a field into <strong>Group rows by</strong> to begin pivoting.
                </td></tr>
              ) : renderRows(grouped, 0, "")}
            </tbody>
            <tfoot className="bg-muted/60 border-t">
              <tr>
                <td className="px-3 py-2 font-semibold text-sm">{totalLabel}</td>
                {colValues.length === 0 ? (
                  <td className="px-3 py-2 text-right font-mono text-sm font-semibold">
                    {formatAggregate(totalRow)}
                  </td>
                ) : (
                  colValues.map((cv) => {
                    const subset = rows.filter((r) => String(r[config.colField!] ?? "—") === cv);
                    const v = config.valueField ? aggregate(numericValues(subset, config.valueField), config.agg) : subset.length;
                    return <td key={cv} className="px-3 py-2 text-right font-mono text-sm font-semibold">
                      {formatAggregate(v)}
                    </td>;
                  })
                )}
              </tr>
            </tfoot>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
