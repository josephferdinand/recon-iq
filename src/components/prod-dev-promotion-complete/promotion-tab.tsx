import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listMyTenants } from "@/lib/tenants.functions";
import {
  promotionOverview,
  promotionCommand,
  promotionOutcome,
  promotionExport,
  promotionReceive,
} from "@/lib/prod-dev-promotion-complete/actions.functions";
import {
  closure,
  canonical,
  validateMappings,
  type Command,
  type Movement,
  type Mapping,
  type Resource,
} from "@/lib/prod-dev-promotion-complete/protocol";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
const selectClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
type Pending = {
  tenantId: string;
  key: string;
  command?: Command;
  envelope?: { schema_version: 1; payload: string; signature: string };
};
const store = "fvi-pdc-pending-v1";
function readPending(): Pending | null {
  if (typeof window === "undefined") return null;
  try {
    return JSON.parse(sessionStorage.getItem(store) ?? "null");
  } catch {
    return null;
  }
}
function keepPending(value: Pending | null) {
  if (value) sessionStorage.setItem(store, JSON.stringify(value));
  else sessionStorage.removeItem(store);
}
export function PromotionCompleteTab({
  sourceTenantId,
}: {
  sourceTenantId?: string;
  familyId?: string;
}) {
  const queryClient = useQueryClient(),
    overview = useServerFn(promotionOverview),
    command = useServerFn(promotionCommand),
    outcome = useServerFn(promotionOutcome),
    exportPackage = useServerFn(promotionExport),
    receive = useServerFn(promotionReceive),
    tenants = useServerFn(listMyTenants);
  const [tenantId, setTenantId] = useState(sourceTenantId ?? ""),
    [open, setOpen] = useState(false),
    [detail, setDetail] = useState<string | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState<Pending | null>(readPending);
  const [form, setForm] = useState({
      root: "",
      group: "",
      environment: "",
      targetTenant: "",
      name: "",
      reason: "",
      search: "",
    }),
    [optional, setOptional] = useState<string[]>([]),
    [mappings, setMappings] = useState<Record<string, Mapping>>({}),
    [importText, setImportText] = useState(""),
    [note, setNote] = useState("");
  const t = useQuery({ queryKey: ["pdc-tenants"], queryFn: () => tenants() });
  const q = useQuery({
    queryKey: ["pdc", tenantId],
    queryFn: () => overview({ data: { tenantId } }),
    enabled: !!tenantId,
  });
  const inventory = q.data?.inventory ?? [],
    movement = q.data?.movements.find((m) => m.id === detail),
    dest = movement?.snapshot.destination.tenantId === tenantId;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["pdc", tenantId] });
  const clear = () => {
    setPending(null);
    keepPending(null);
  };
  const run = async (value: Command) => {
    if (busy || pending) return;
    setError("");
    setMessage("");
    const p: Pending = {
      tenantId,
      key: crypto.randomUUID(),
      command: { ...value, key: crypto.randomUUID() },
    };
    p.key = p.command!.key;
    try {
      keepPending(p);
      setPending(p);
      setBusy(true);
      const r = await command({ data: p.command! });
      clear();
      setMessage("Request recorded: " + r.stage.replaceAll("_", " "));
      await refresh();
    } catch (e) {
      const text = (e as Error).message;
      setError(text);
      if (
        text.startsWith("Request refused:") ||
        text.startsWith("Complete current MFA") ||
        text.startsWith("Source changed") ||
        text.startsWith("Target binding changed")
      )
        clear();
    } finally {
      setBusy(false);
    }
  };
  const checkReceipt = async () => {
    if (!pending) return;
    setBusy(true);
    setError("");
    try {
      const found = await outcome({ data: { tenantId: pending.tenantId, key: pending.key } });
      if (found) {
        clear();
        setMessage("Retained receipt confirmed: " + found.stage.replaceAll("_", " "));
        await refresh();
      } else
        setMessage(
          "No committed receipt was found. The original request remains retained; retry sends the same inputs and key.",
        );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const retry = async () => {
    if (!pending || busy) return;
    setBusy(true);
    setError("");
    try {
      const r = pending.command
        ? await command({ data: pending.command })
        : await receive({
            data: { tenantId: pending.tenantId, key: pending.key, envelope: pending.envelope! },
          });
      clear();
      setMessage("Retained request confirmed: " + r.stage.replaceAll("_", " "));
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  let selected: Resource[] = [],
    selectionError = "";
  try {
    if (form.root && form.group) selected = closure(form.root, form.group, optional, inventory);
  } catch (e) {
    selectionError = (e as Error).message;
  }
  const action = (op: Command["operation"], m?: Mapping[]) =>
    movement &&
    run({
      operation: op,
      tenantId,
      key: "pending-key",
      id: movement.id,
      expectedRevision: movement.revision,
      mappings: m,
      note,
    });
  const exportFile = async (m: Movement) => {
    setBusy(true);
    setError("");
    try {
      const signed = await exportPackage({ data: { tenantId, id: m.id } }),
        url = URL.createObjectURL(new Blob([JSON.stringify(signed)], { type: "application/json" })),
        link = document.createElement("a");
      link.href = url;
      link.download = "reconiq-promotion-" + m.id + ".json";
      link.click();
      URL.revokeObjectURL(url);
      setMessage(
        "Signed package downloaded. Import in the addressed destination within five minutes.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const importFile = async () => {
    setError("");
    if (pending || busy) return;
    try {
      const env = JSON.parse(importText);
      if (importText.length > 2000000) throw Error("Package exceeds 2 MB");
      const p: Pending = { tenantId, key: crypto.randomUUID(), envelope: env };
      keepPending(p);
      setPending(p);
      setBusy(true);
      const r = await receive({ data: { tenantId, key: p.key, envelope: env } });
      clear();
      setImportText("");
      setMessage("Received " + r.snapshot.name + " for destination review");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const modalFeedback = (
    <>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {message && <p role="status" className="text-sm">{message}</p>}
      {pending && <div className="space-y-2 rounded-md border p-3">
        <p className="text-sm">The outcome is unconfirmed. Keep this request key until its receipt is confirmed.</p>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} variant="outline" onClick={checkReceipt}>Check retained receipt</Button>
          <Button disabled={busy} variant="outline" onClick={retry}>Retry retained request</Button>
        </div>
      </div>}
    </>
  );
  return (
    <section className="space-y-5" aria-label="Environment package promotion">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Move a reconciliation between environments</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Review dependencies, obtain destination approval, and confirm receipt before installing
            the package.
          </p>
        </div>
        <Button
          disabled={!tenantId || busy || !!pending || q.isPending}
          onClick={() => setOpen(true)}
        >
          Build package
        </Button>
      </header>
      <label className="block max-w-lg space-y-1 text-sm">
        Current tenant
        <select
          aria-label="Current tenant"
          className={selectClass}
          value={tenantId}
          disabled={busy || !!pending}
          onChange={(e) => {
            setTenantId(e.target.value);
            setDetail(null);
            setMappings({});
            setForm({
              root: "",
              group: "",
              environment: "",
              targetTenant: "",
              name: "",
              reason: "",
              search: "",
            });
            setOptional([]);
          }}
        >
          <option value="">Select your tenant</option>
          {(t.data ?? []).map((x: any) => (
            <option key={x.id} value={x.id}>
              {x.name} ({x.environment})
            </option>
          ))}
        </select>
      </label>
      {(error || q.error || t.error) && (
        <p
          role="alert"
          className="rounded-md border border-destructive p-3 text-sm text-destructive"
        >
          {error || (q.error as Error)?.message || (t.error as Error)?.message}
        </p>
      )}
      {message && (
        <p role="status" className="rounded-md border p-3 text-sm">
          {message}
        </p>
      )}
      {pending && (
        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm">
            A request is awaiting a confirmed outcome. Its original inputs and key are retained in
            this browser tab.
          </p>
          <div className="flex gap-2">
            <Button disabled={busy} variant="outline" onClick={checkReceipt}>
              Check retained receipt
            </Button>
            <Button disabled={busy} variant="outline" onClick={retry}>
              Retry retained request
            </Button>
          </div>
        </div>
      )}
      {q.isPending && tenantId && <p role="status">Loading current access and dependencies…</p>}
      {q.data && (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Promotion requests for the current tenant</caption>
            <thead className="border-b bg-muted">
              <tr>
                <th className="p-3">Package</th>
                <th className="p-3">Direction</th>
                <th className="p-3">Stage</th>
                <th className="p-3">Review</th>
              </tr>
            </thead>
            <tbody>
              {q.data.movements.map((m) => (
                <tr className="border-b" key={m.id}>
                  <td className="p-3">{m.snapshot.name}</td>
                  <td className="p-3">
                    {m.snapshot.source.environment} → {m.snapshot.destination.environment}
                  </td>
                  <td className="p-3">
                    <Badge variant="outline">{m.stage.replaceAll("_", " ")}</Badge>
                  </td>
                  <td className="p-3">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setDetail(m.id);
                        setMappings(Object.fromEntries(m.mappings.map((x) => [x.sourceKey, x])));
                      }}
                    >
                      View package
                    </Button>
                  </td>
                </tr>
              ))}
              {!q.data.movements.length && (
                <tr>
                  <td className="p-6 text-muted-foreground" colSpan={4}>
                    No package requests. Select a reconciliation to prepare its dependencies.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {tenantId && (
        <details className="rounded-md border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            Receive an approved package
          </summary>
          <div className="mt-3 space-y-3">
            <label className="block text-sm">
              Signed package file
              <input
                type="file"
                accept=".json,application/json"
                className="mt-1 block w-full"
                disabled={busy || !!pending}
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  if (f.size > 2000000) {
                    setError("Package exceeds 2 MB");
                    return;
                  }
                  setImportText(await f.text());
                }}
              />
            </label>
            <label className="block text-sm">
              Package contents
              <Textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                rows={4}
                maxLength={2000000}
              />
            </label>
            <Button disabled={!importText || busy || !!pending} onClick={importFile}>
              Verify and receive
            </Button>
          </div>
        </details>
      )}
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!busy) setOpen(o);
        }}
      >
        <DialogContent className="flex max-h-[90dvh] max-w-4xl flex-col">
          <DialogHeader>
            <DialogTitle>Build promotion package</DialogTitle>
          </DialogHeader>
          {modalFeedback}
          <div className="min-h-0 space-y-4 overflow-y-auto px-1">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1 text-sm">
                Reconciliation
                <select
                  className={selectClass}
                  value={form.root}
                  onChange={(e) => setForm({ ...form, root: e.target.value })}
                >
                  <option value="">Select reconciliation</option>
                  {inventory
                    .filter((r) => r.kind === "reconciliation")
                    .map((r) => (
                      <option key={r.key} value={r.key}>
                        {r.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                Requesting group
                <select
                  className={selectClass}
                  value={form.group}
                  onChange={(e) => setForm({ ...form, group: e.target.value })}
                >
                  <option value="">Select group</option>
                  {inventory
                    .filter((r) => r.kind === "group")
                    .map((r) => (
                      <option key={r.key} value={r.key}>
                        {r.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                Destination environment
                <select
                  className={selectClass}
                  value={form.environment}
                  onChange={(e) => setForm({ ...form, environment: e.target.value })}
                >
                  <option value="">Select registered environment</option>
                  {q.data?.registry
                    .filter((r) => r.enabled && r.environment !== q.data.address.environment)
                    .map((r) => (
                      <option key={r.environment} value={r.environment} disabled={r.held}>
                        {r.environment}
                        {r.held ? " (held)" : ""}
                      </option>
                    ))}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                Destination tenant ID
                <Input
                  value={form.targetTenant}
                  maxLength={36}
                  onChange={(e) => setForm({ ...form, targetTenant: e.target.value })}
                />
                <span className="text-xs text-muted-foreground">
                  Use the tenant ID shown in the destination. The registered organization must
                  match.
                </span>
              </label>
              <label className="space-y-1 text-sm">
                Package name
                <Input
                  value={form.name}
                  maxLength={120}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </label>
              <label className="space-y-1 text-sm">
                Reason
                <Textarea
                  value={form.reason}
                  maxLength={1000}
                  rows={2}
                  onChange={(e) => setForm({ ...form, reason: e.target.value })}
                />
              </label>
            </div>
            <label className="block text-sm">
              Find optional dependencies
              <Input
                value={form.search}
                onChange={(e) => setForm({ ...form, search: e.target.value })}
                placeholder="Search sources, Data Prep, reports and settings"
              />
            </label>
            <div className="max-h-52 overflow-y-auto rounded-md border p-3">
              {inventory
                .filter(
                  (r) =>
                    !["reconciliation", "group", "business_unit"].includes(r.kind) &&
                    r.name.toLowerCase().includes(form.search.toLowerCase()),
                )
                .map((r) => (
                  <label key={r.key} className="flex items-center gap-3 py-1 text-sm">
                    <input
                      type="checkbox"
                      checked={optional.includes(r.key)}
                      onChange={(e) =>
                        setOptional(
                          e.target.checked
                            ? [...optional, r.key]
                            : optional.filter((k) => k !== r.key),
                        )
                      }
                    />
                    <span>
                      {r.name}{" "}
                      <span className="text-muted-foreground">({r.kind.replaceAll("_", " ")})</span>
                    </span>
                  </label>
                ))}
            </div>
            <div className="rounded-md border p-3">
              <h3 className="font-medium">Included dependencies ({selected.length})</h3>
              {selectionError ? (
                <p role="alert" className="text-destructive">
                  {selectionError}
                </p>
              ) : (
                <ul className="mt-2 space-y-1 text-sm">
                  {selected.map((r) => (
                    <li key={r.key}>
                      {r.name}{" "}
                      <span className="text-muted-foreground">— {r.kind.replaceAll("_", " ")}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <footer className="flex justify-end gap-2 border-t pt-3">
            <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                busy ||
                !!pending ||
                !selected.length ||
                !!selectionError ||
                !form.environment ||
                !form.targetTenant ||
                form.name.trim().length < 3 ||
                form.reason.trim().length < 10
              }
              onClick={() => {
                const source = q.data!.address,
                  target = q.data!.registry.find((r) => r.environment === form.environment)!;
                run({
                  operation: "request",
                  tenantId,
                  key: "pending-key",
                  snapshot: {
                    protocol: "fvi-pdc-1",
                    source,
                    destination: {
                      ...source,
                      environment: target.environment,
                      projectRef: target.projectRef,
                      tenantId: form.targetTenant,
                    },
                    root: form.root,
                    group: form.group,
                    resources: selected,
                    name: form.name,
                    reason: form.reason,
                  },
                  note: "",
                });
              }}
            >
              Request source approval
            </Button>
          </footer>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!movement}
        onOpenChange={(o) => {
          if (!o && !busy) setDetail(null);
        }}
      >
        <DialogContent className="flex max-h-[90dvh] max-w-5xl flex-col">
          <DialogHeader>
            <DialogTitle>{movement?.snapshot.name ?? "Package review"}</DialogTitle>
          </DialogHeader>
          {modalFeedback}
          {movement && (
            <>
              <div className="min-h-0 space-y-4 overflow-y-auto px-1">
                <p className="text-sm">{movement.snapshot.reason}</p>
                <p className="text-sm text-muted-foreground">
                  {movement.snapshot.source.environment} →{" "}
                  {movement.snapshot.destination.environment}; revision {movement.revision};{" "}
                  {movement.stage.replaceAll("_", " ")}
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr>
                        <th className="p-2">Dependency</th>
                        <th className="p-2">Destination</th>
                      </tr>
                    </thead>
                    <tbody>
                      {movement.snapshot.resources.map((r) => (
                        <tr key={r.key} className="border-t">
                          <td className="p-2">
                            {r.name}
                            <span className="block text-xs text-muted-foreground">
                              {r.kind.replaceAll("_", " ")}
                            </span>
                          </td>
                          <td className="space-y-2 p-2">
                            {dest && movement.stage === "received" ? (
                              <>
                                <select
                                  aria-label={"Map " + r.name}
                                  className={selectClass}
                                  value={
                                    mappings[r.key]?.mode === "create"
                                      ? "create"
                                      : (mappings[r.key]?.targetId ?? "")
                                  }
                                  onChange={(e) => {
                                    const value = e.target.value,
                                      t = inventory.find(
                                        (t) => t.id === value && t.kind === r.kind,
                                      );
                                    setMappings({
                                      ...mappings,
                                      [r.key]:
                                        value === "create"
                                          ? { sourceKey: r.key, mode: "create", name: r.name }
                                          : {
                                              sourceKey: r.key,
                                              mode: "reuse",
                                              targetId: t?.id,
                                              revision: t?.revision,
                                              digest: t?.digest,
                                            },
                                    });
                                  }}
                                >
                                  <option value="">Select destination binding</option>
                                  {[
                                    "reconciliation",
                                    "source",
                                    "data_prep",
                                    "report",
                                    "settings",
                                  ].includes(r.kind) && (
                                    <option value="create">
                                      Create a new {r.kind.replaceAll("_", " ")}
                                    </option>
                                  )}
                                  {r.key !== movement.snapshot.root &&
                                    inventory
                                      .filter((t) => t.kind === r.kind)
                                      .map((t) => (
                                        <option key={t.key} value={t.id}>
                                          {t.name}
                                        </option>
                                      ))}
                                </select>
                                {mappings[r.key]?.mode === "create" && (
                                  <Input
                                    aria-label={"New name for " + r.name}
                                    value={mappings[r.key].name ?? ""}
                                    maxLength={120}
                                    onChange={(e) =>
                                      setMappings({
                                        ...mappings,
                                        [r.key]: { ...mappings[r.key], name: e.target.value },
                                      })
                                    }
                                  />
                                )}
                              </>
                            ) : (
                              <span>
                                {movement.mappings.find((x) => x.sourceKey === r.key)?.name ??
                                  inventory.find(
                                    (t) =>
                                      t.id ===
                                      movement.mappings.find((x) => x.sourceKey === r.key)
                                        ?.targetId,
                                  )?.name ??
                                  "Source dependency pinned"}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {movement.stage === "applied" && (
                  <p role="status">
                    Installed definition ID: {movement.installed[movement.snapshot.root]}. Sources
                    contain configuration only; connect approved destination feeds before running.
                  </p>
                )}
                <label className="block text-sm">
                  Decision note
                  <Textarea
                    value={note}
                    maxLength={1000}
                    onChange={(e) => setNote(e.target.value)}
                    rows={2}
                  />
                </label>
              </div>
              <footer className="flex flex-wrap gap-2 border-t pt-3">
                {movement.stage === "requested" && (
                  <>
                    <Button disabled={busy || !!pending} onClick={() => action("approve")}>
                      Approve source package
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy || !!pending}
                      onClick={() => action("withdraw")}
                    >
                      Withdraw request
                    </Button>
                  </>
                )}
                {movement.stage === "source_approved" && (
                  <Button disabled={busy || !!pending} onClick={() => exportFile(movement)}>
                    Download signed package
                  </Button>
                )}
                {dest && movement.stage === "received" && (
                  <Button
                    disabled={busy || !!pending}
                    onClick={() => {
                      try {
                        const map = movement.snapshot.resources.map((r) => mappings[r.key]);
                        validateMappings(movement.snapshot, map, inventory);
                        action("approve", map);
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    Approve destination mappings
                  </Button>
                )}
                {dest && movement.stage === "approved" && (
                  <Button disabled={busy || !!pending} onClick={() => action("accept")}>
                    Accept as recipient
                  </Button>
                )}
                {dest && movement.stage === "accepted" && (
                  <Button disabled={busy || !!pending} onClick={() => action("apply")}>
                    Install approved package
                  </Button>
                )}
                {["requested", "received"].includes(movement.stage) && (
                  <Button
                    variant="outline"
                    disabled={busy || !!pending}
                    onClick={() => action("reject")}
                  >
                    Reject package
                  </Button>
                )}
                <Button variant="outline" disabled={busy} onClick={() => setDetail(null)}>
                  Close
                </Button>
              </footer>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
