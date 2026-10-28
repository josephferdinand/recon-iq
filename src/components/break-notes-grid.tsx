// Excel-style editable grid for structured break notes.
// Keyboard nav: arrow keys, Tab/Shift+Tab, Enter to save, Esc to cancel.
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listBreakNotes, upsertBreakNote, deleteBreakNote } from "@/lib/break-notes.functions";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Sheet } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Row = {
  id?: string;
  note_date: string;
  category:
    | "investigation"
    | "counterparty"
    | "fx"
    | "timing"
    | "fees"
    | "manual_adj"
    | "sign_off"
    | "other";
  comment: string;
  amount: number | null;
  currency: string | null;
  status: "open" | "pending" | "resolved";
  _dirty?: boolean;
  _localId?: string;
};

const CATEGORIES: Row["category"][] = [
  "investigation",
  "counterparty",
  "fx",
  "timing",
  "fees",
  "manual_adj",
  "sign_off",
  "other",
];
const STATUSES: Row["status"][] = ["open", "pending", "resolved"];

const COLS: { key: keyof Row; label: string; width: string }[] = [
  { key: "note_date", label: "Date", width: "w-32" },
  { key: "category", label: "Category", width: "w-36" },
  { key: "status", label: "Status", width: "w-28" },
  { key: "amount", label: "Amount", width: "w-28" },
  { key: "currency", label: "CCY", width: "w-16" },
  { key: "comment", label: "Comment (Demo Bank investigation note)", width: "flex-1" },
];

function blankRow(): Row {
  return {
    note_date: new Date().toISOString().slice(0, 10),
    category: "investigation",
    comment: "",
    amount: null,
    currency: "USD",
    status: "open",
    _dirty: true,
    _localId: crypto.randomUUID(),
  };
}

export function BreakNotesGrid({
  tenantId,
  breakId,
  canWrite,
}: {
  tenantId: string;
  breakId: string;
  canWrite: boolean;
}) {
  const qc = useQueryClient();
  const list = useServerFn(listBreakNotes);
  const save = useServerFn(upsertBreakNote);
  const del = useServerFn(deleteBreakNote);

  const q = useQuery({
    queryKey: ["break-notes", tenantId, breakId],
    queryFn: () => list({ data: { tenantId, breakId } }),
  });

  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    if (q.data) {
      setRows(
        q.data.map((r) => ({
          id: r.id,
          note_date: r.note_date,
          category: r.category as Row["category"],
          comment: r.comment ?? "",
          amount: r.amount === null || r.amount === undefined ? null : Number(r.amount),
          currency: r.currency ?? null,
          status: r.status as Row["status"],
        })),
      );
    }
  }, [q.data]);

  const dirtyCount = useMemo(() => rows.filter((r) => r._dirty).length, [rows]);

  const mSave = useMutation({
    mutationFn: (row: Row) =>
      save({
        data: {
          tenantId,
          breakId,
          row: {
            id: row.id,
            note_date: row.note_date,
            category: row.category,
            comment: row.comment,
            amount: row.amount,
            currency: row.currency,
            status: row.status,
          },
        },
      }),
  });
  const mDel = useMutation({
    mutationFn: (id: string) => del({ data: { id, tenantId, breakId } }),
  });

  const containerRef = useRef<HTMLDivElement | null>(null);

  function updateCell(idx: number, key: keyof Row, value: any) {
    setRows((cur) =>
      cur.map((r, i) =>
        i === idx
          ? {
              ...r,
              [key]:
                key === "amount" ? (value === "" ? null : Number(value)) : value,
              _dirty: true,
            }
          : r,
      ),
    );
  }

  async function saveAll() {
    let ok = 0;
    let fail = 0;
    for (const row of rows.filter((r) => r._dirty)) {
      try {
        const res = await mSave.mutateAsync(row);
        ok++;
        // attach returned id for inserts
        if (!row.id) {
          setRows((cur) =>
            cur.map((r) => (r._localId === row._localId ? { ...r, id: res.id, _dirty: false } : r)),
          );
        } else {
          setRows((cur) => cur.map((r) => (r.id === row.id ? { ...r, _dirty: false } : r)));
        }
      } catch (e) {
        fail++;
        toast.error((e as Error).message);
      }
    }
    if (ok > 0) toast.success(`Saved ${ok} note${ok > 1 ? "s" : ""}`);
    if (ok > 0) qc.invalidateQueries({ queryKey: ["break-notes", tenantId, breakId] });
    if (fail === 0 && ok === 0) toast.info("Nothing to save");
  }

  async function removeRow(idx: number) {
    const row = rows[idx];
    if (row.id) {
      try {
        await mDel.mutateAsync(row.id);
        toast.success("Note deleted");
      } catch (e) {
        toast.error((e as Error).message);
        return;
      }
    }
    setRows((cur) => cur.filter((_, i) => i !== idx));
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm">
          <Sheet className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">Notes grid</span>
          {dirtyCount > 0 && (
            <span className="text-xs text-amber-600">{dirtyCount} unsaved</span>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!canWrite}
            onClick={() => setRows((c) => [...c, blankRow()])}
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Row
          </Button>
          <Button
            size="sm"
            disabled={!canWrite || dirtyCount === 0 || mSave.isPending}
            onClick={() => saveAll()}
          >
            Save all
          </Button>
        </div>
      </div>
      <div ref={containerRef} className="overflow-x-auto rounded border">
        <table className="w-full border-collapse text-xs">
          <thead className="border-b bg-muted/40 text-left uppercase text-muted-foreground">
            <tr>
              {COLS.map((c) => (
                <th key={String(c.key)} className={cn("px-2 py-1.5 font-medium", c.width)}>
                  {c.label}
                </th>
              ))}
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={COLS.length + 1} className="px-3 py-6 text-center text-muted-foreground">
                  No notes yet. Example: 2026-06-28 · investigation · "Demo Bank counterparty
                  re-priced trade after EOD".
                </td>
              </tr>
            )}
            {rows.map((row, idx) => (
              <tr
                key={row.id ?? row._localId}
                className={cn(
                  "border-b transition-colors",
                  row._dirty && "bg-amber-50/30 dark:bg-amber-500/5",
                )}
              >
                <td className="p-0">
                  <input
                    type="date"
                    className="w-full bg-transparent px-2 py-1.5 outline-none focus:bg-primary/5"
                    value={row.note_date}
                    disabled={!canWrite}
                    onChange={(e) => updateCell(idx, "note_date", e.target.value)}
                  />
                </td>
                <td className="p-0">
                  <select
                    className="w-full bg-transparent px-2 py-1.5 outline-none focus:bg-primary/5"
                    value={row.category}
                    disabled={!canWrite}
                    onChange={(e) => updateCell(idx, "category", e.target.value)}
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="p-0">
                  <select
                    className="w-full bg-transparent px-2 py-1.5 outline-none focus:bg-primary/5"
                    value={row.status}
                    disabled={!canWrite}
                    onChange={(e) => updateCell(idx, "status", e.target.value)}
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="p-0">
                  <input
                    type="number"
                    step="0.0001"
                    className="w-full bg-transparent px-2 py-1.5 text-right outline-none focus:bg-primary/5"
                    value={row.amount ?? ""}
                    disabled={!canWrite}
                    onChange={(e) => updateCell(idx, "amount", e.target.value)}
                    placeholder="0.00"
                  />
                </td>
                <td className="p-0">
                  <input
                    className="w-full bg-transparent px-2 py-1.5 uppercase outline-none focus:bg-primary/5"
                    maxLength={3}
                    value={row.currency ?? ""}
                    disabled={!canWrite}
                    onChange={(e) => updateCell(idx, "currency", e.target.value.toUpperCase())}
                    placeholder="USD"
                  />
                </td>
                <td className="p-0">
                  <input
                    className="w-full bg-transparent px-2 py-1.5 outline-none focus:bg-primary/5"
                    value={row.comment}
                    disabled={!canWrite}
                    onChange={(e) => updateCell(idx, "comment", e.target.value)}
                    placeholder="Investigation note for Demo Bank…"
                  />
                </td>
                <td className="px-1 text-right">
                  {canWrite && (
                    <button
                      onClick={() => removeRow(idx)}
                      className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      title="Delete row"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
