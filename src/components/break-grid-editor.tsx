import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { evaluateFormula, indexToColLetter, colLetterToIndex, type CellAddr } from "@/lib/formula-engine";
import { Download, FunctionSquare, Plus, Save, Sigma } from "lucide-react";

type CellRaw = string;

export interface BreakGridEditorProps {
  /** Initial rows of plain values (string|number). Headers are derived as A,B,C… */
  initialRows?: (string | number | null)[][];
  initialColumns?: string[];
  rows?: number;
  cols?: number;
  onSave?: (rows: CellRaw[][]) => void;
  title?: string;
}

/**
 * Excel-like grid with formula bar.
 * - Cells store raw input ("=SUM(A1:A4)") and display computed values.
 * - Keyboard: Enter commits + moves down, Tab moves right, Esc cancels, arrows navigate.
 * - Formula bar reflects the active cell's raw input and supports editing.
 */
export function BreakGridEditor({
  initialRows,
  initialColumns,
  rows: rowCount = 30,
  cols: colCount = 12,
  onSave,
  title = "Break Investigation Grid",
}: BreakGridEditorProps) {
  const totalCols = Math.max(colCount, initialColumns?.length ?? 0, initialRows?.[0]?.length ?? 0);
  const totalRows = Math.max(rowCount, initialRows?.length ?? 0);

  const [data, setData] = useState<CellRaw[][]>(() => {
    const grid: CellRaw[][] = Array.from({ length: totalRows }, () =>
      Array.from({ length: totalCols }, () => ""),
    );
    initialRows?.forEach((row, r) =>
      row.forEach((v, c) => {
        if (v != null) grid[r][c] = String(v);
      }),
    );
    return grid;
  });

  const [active, setActive] = useState<CellAddr>({ row: 0, col: 0 });
  const [editing, setEditing] = useState<CellAddr | null>(null);
  const [draft, setDraft] = useState<string>("");
  const formulaRef = useRef<HTMLInputElement>(null);
  const cellRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  const get = useCallback(
    (addr: CellAddr): string | number | null => {
      const raw = data[addr.row]?.[addr.col];
      if (raw == null || raw === "") return null;
      if (!raw.trim().startsWith("=")) {
        const n = Number(raw);
        return Number.isFinite(n) && raw.trim() !== "" ? n : raw;
      }
      const r = evaluateFormula(raw, get);
      return r.value as any;
    },
    [data],
  );

  const display = useCallback(
    (r: number, c: number): string => {
      const raw = data[r]?.[c] ?? "";
      if (!raw.trim().startsWith("=")) return raw;
      const result = evaluateFormula(raw, get);
      const v = result.value;
      if (v == null) return "";
      if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toLocaleString(undefined, { maximumFractionDigits: 6 });
      return String(v);
    },
    [data, get],
  );

  const setCell = (addr: CellAddr, value: string) => {
    setData((prev) => {
      const next = prev.map((row) => row.slice());
      while (next.length <= addr.row) next.push(Array.from({ length: totalCols }, () => ""));
      while (next[addr.row].length <= addr.col) next[addr.row].push("");
      next[addr.row][addr.col] = value;
      return next;
    });
  };

  const commitEdit = (nextAddr?: CellAddr) => {
    if (editing) setCell(editing, draft);
    setEditing(null);
    if (nextAddr) {
      setActive(nextAddr);
      setTimeout(() => cellRefs.current.get(`${nextAddr.row}:${nextAddr.col}`)?.focus(), 0);
    }
  };

  const beginEdit = (addr: CellAddr, seed?: string) => {
    setActive(addr);
    setEditing(addr);
    setDraft(seed ?? data[addr.row]?.[addr.col] ?? "");
  };

  const move = (dr: number, dc: number) => {
    const next: CellAddr = {
      row: Math.max(0, Math.min(totalRows - 1, active.row + dr)),
      col: Math.max(0, Math.min(totalCols - 1, active.col + dc)),
    };
    setActive(next);
    setEditing(null);
    setTimeout(() => cellRefs.current.get(`${next.row}:${next.col}`)?.focus(), 0);
  };

  const onCellKey = (e: React.KeyboardEvent, addr: CellAddr) => {
    if (editing && editing.row === addr.row && editing.col === addr.col) {
      if (e.key === "Enter") { e.preventDefault(); commitEdit({ row: addr.row + 1, col: addr.col }); }
      else if (e.key === "Tab") { e.preventDefault(); commitEdit({ row: addr.row, col: addr.col + (e.shiftKey ? -1 : 1) }); }
      else if (e.key === "Escape") { setEditing(null); }
      return;
    }
    if (e.key === "Enter" || e.key === "F2") { e.preventDefault(); beginEdit(addr); }
    else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); setCell(addr, ""); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1, 0); }
    else if (e.key === "ArrowDown") { e.preventDefault(); move(1, 0); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); move(0, -1); }
    else if (e.key === "ArrowRight" || e.key === "Tab") { e.preventDefault(); move(0, e.shiftKey ? -1 : 1); }
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) { e.preventDefault(); beginEdit(addr, e.key); }
  };

  const exportCsv = () => {
    const lines = data.map((row) =>
      row.map((c, i) => {
        const v = c.trim().startsWith("=") ? String(get({ row: data.indexOf(row), col: i }) ?? "") : c;
        return `"${v.replaceAll('"', '""')}"`;
      }).join(","),
    ).join("\n");
    const blob = new Blob([lines], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${title.replaceAll(" ", "_")}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const activeRaw = data[active.row]?.[active.col] ?? "";
  const activeLabel = `${indexToColLetter(active.col)}${active.row + 1}`;
  const colHeaders = useMemo(
    () => Array.from({ length: totalCols }, (_, i) => initialColumns?.[i] ?? indexToColLetter(i)),
    [totalCols, initialColumns],
  );

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <Sigma className="h-4 w-4 text-primary" /> {title}
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Formulas supported: =SUM, =AVG, =COUNT, =MIN, =MAX, =IF, =ROUND, =CONCAT, =LEN, ranges (A1:A10), comparisons.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv}><Download className="h-4 w-4 mr-1" />CSV</Button>
          {onSave && (
            <Button size="sm" onClick={() => onSave(data)}><Save className="h-4 w-4 mr-1" />Save</Button>
          )}
        </div>
      </CardHeader>

      {/* Formula bar */}
      <div className="border-y bg-muted/30 px-3 py-2 flex items-center gap-2">
        <Badge variant="outline" className="font-mono text-xs">{activeLabel}</Badge>
        <FunctionSquare className="h-4 w-4 text-muted-foreground" />
        <Input
          ref={formulaRef}
          value={editing ? draft : activeRaw}
          onChange={(e) => {
            if (!editing) setEditing(active);
            setDraft(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { commitEdit({ row: active.row + 1, col: active.col }); }
            if (e.key === "Escape") { setEditing(null); }
          }}
          placeholder="Enter value or =formula"
          className="font-mono text-sm h-8"
        />
      </div>

      <CardContent className="p-0">
        <div className="overflow-auto max-h-[70vh]">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-muted">
              <tr>
                <th className="w-12 border-b border-r bg-muted px-2 py-1 text-xs font-medium text-muted-foreground"></th>
                {colHeaders.map((h, i) => (
                  <th key={i} className="min-w-[100px] border-b border-r bg-muted px-2 py-1 text-xs font-semibold text-foreground/80 text-left">
                    <div className="flex items-center justify-between">
                      <span className="truncate">{h}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">{indexToColLetter(i)}</span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row, r) => (
                <tr key={r}>
                  <td className="w-12 border-b border-r bg-muted/50 px-2 py-0 text-center text-xs font-mono text-muted-foreground">{r + 1}</td>
                  {row.map((_cell, c) => {
                    const isActive = active.row === r && active.col === c;
                    const isEditing = editing && editing.row === r && editing.col === c;
                    return (
                      <td key={c} className={`border-b border-r p-0 ${isActive ? "ring-2 ring-primary ring-inset" : ""}`}>
                        {isEditing ? (
                          <input
                            autoFocus
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onBlur={() => commitEdit()}
                            onKeyDown={(e) => onCellKey(e as any, { row: r, col: c })}
                            className="w-full h-7 px-2 font-mono text-sm bg-background outline-none"
                          />
                        ) : (
                          <input
                            ref={(el) => { if (el) cellRefs.current.set(`${r}:${c}`, el); }}
                            readOnly
                            value={display(r, c)}
                            onFocus={() => setActive({ row: r, col: c })}
                            onClick={() => setActive({ row: r, col: c })}
                            onDoubleClick={() => beginEdit({ row: r, col: c })}
                            onKeyDown={(e) => onCellKey(e, { row: r, col: c })}
                            className="w-full h-7 px-2 bg-transparent outline-none cursor-cell"
                          />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t bg-muted/30 px-3 py-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>Rows: {totalRows} · Cols: {totalCols}</span>
          <Button variant="ghost" size="sm" onClick={() => setData((d) => [...d, Array.from({ length: totalCols }, () => "")])}>
            <Plus className="h-3 w-3 mr-1" />Add row
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export { colLetterToIndex, indexToColLetter };
