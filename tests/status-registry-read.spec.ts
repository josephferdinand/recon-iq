import { it, expect, vi } from "vitest";
import { readRegisteredStatusRows } from "@/lib/status-registry-read.server";
function client(pages: unknown[], error: unknown = null) {
  const query: any = { select: vi.fn(() => query), order: vi.fn(() => query), range: vi.fn(() => query), abortSignal: vi.fn(async () => ({ data: pages.shift(), error })) };
  return { from: vi.fn(() => query), query };
}
it("reads every registered row beyond a default 1000-row response cap", async () => {
  const full = Array.from({ length: 500 }, (_, i) => ({ cell_key: `synthetic-${i}` })); const db = client([full, full, [{ cell_key: "last" }]]);
  expect(await readRegisteredStatusRows(db, "cells")).toHaveLength(1001); expect(db.query.range.mock.calls).toEqual([[0,499],[500,999],[1000,1499]]);
});
it("fails closed on denied or truncated registry transport instead of omitting scopes", async () => {
  await expect(readRegisteredStatusRows(client([null], { message: "private" }), "functions")).rejects.toThrow("complete registered status scope");
});
it("fails closed above its verified capacity while preserving all cells up to that bound", async () => {
  const full = Array.from({ length: 500 }, (_, i) => ({ function_key: `synthetic-${i}` })); const db = client([...Array(20).fill(full), [{}]]);
  await expect(readRegisteredStatusRows(db, "functions")).rejects.toThrow("verified capacity"); expect(db.query.order).toHaveBeenCalledWith("function_key");
});
