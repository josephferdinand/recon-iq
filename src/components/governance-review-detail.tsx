/* eslint-disable react-refresh/only-export-components -- Shared view helpers remain in this leased file to keep the queue/view import graph acyclic. */
import { useMemo, useRef, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, AlertCircle, ChevronLeft, ChevronRight, LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
export type GovernanceSummary = {
  label: string;
  value: number;
  hint: string;
  tone?: "default" | "good" | "warning";
};

export function GovernanceDetailPanel({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const priorFocus = useRef<HTMLElement | null>(
    typeof document === "undefined" ? null : (document.activeElement as HTMLElement),
  );
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/40" />
        <Dialog.Content
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (priorFocus.current?.isConnected) priorFocus.current.focus();
          }}
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col bg-white shadow-xl focus:outline-none"
        >
          <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 p-5 sm:p-7">
            <div>
              <Dialog.Title className="text-xl font-semibold text-slate-950">{title}</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-slate-600">
                Current scope, version and recorded evidence
              </Dialog.Description>
            </div>
            <Dialog.Close
              aria-label="Close details"
              className="rounded-md border border-slate-300 p-2 text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"
            >
              <X className="h-4 w-4" />
            </Dialog.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-7">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function useGovernanceFilters() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [environment, setEnvironment] = useState("all");
  const filters = useMemo(
    () => ({
      page,
      pageSize: 10,
      search: search.trim(),
      environment: environment === "all" ? "" : environment,
    }),
    [page, search, environment],
  );
  return { filters, page, setPage, search, setSearch, environment, setEnvironment };
}

export function GovernanceToolbar({
  search,
  onSearch,
  searchLabel = "Search governance records",
  searchPlaceholder = "Search request, person, team or group",
  maxSearchLength = 200,
  environment = "all",
  onEnvironment,
  environmentValues = [],
  showEnvironment = true,
  children,
}: {
  search: string;
  onSearch: (value: string) => void;
  searchLabel?: string;
  searchPlaceholder?: string;
  maxSearchLength?: number;
  environment?: string;
  onEnvironment?: (value: string) => void;
  environmentValues?: string[];
  showEnvironment?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
      <Input
        aria-label={searchLabel}
        maxLength={maxSearchLength}
        value={search}
        onChange={(event) => onSearch(event.target.value)}
        placeholder={searchPlaceholder}
        className="min-w-[220px] flex-1"
      />
      {showEnvironment && onEnvironment ? (
        <Select value={environment} onValueChange={onEnvironment}>
          <SelectTrigger aria-label="Environment" className="w-[160px]">
            <SelectValue placeholder="Environment" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All environments</SelectItem>
            {[...new Set(environmentValues)].map((item) => (
              <SelectItem key={item} value={item}>
                {item.toUpperCase()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      {children}
    </div>
  );
}

export function GovernanceSummaryCards({ items }: { items: GovernanceSummary[] }) {
  return (
    <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {items.slice(0, 4).map((item) => (
        <article key={item.label} className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-600">{item.label}</p>
          <p
            className={`mt-2 text-3xl font-semibold tabular-nums ${item.tone === "warning" ? "text-amber-800" : item.tone === "good" ? "text-emerald-800" : "text-slate-950"}`}
          >
            {item.value.toLocaleString()}
          </p>
          <p className="mt-1 text-xs text-slate-600">{item.hint}</p>
        </article>
      ))}
    </div>
  );
}

export function GovernancePanel({ children, label }: { children: ReactNode; label: string }) {
  return (
    <section aria-label={label} className="rounded-lg border border-slate-200 bg-white">
      {children}
    </section>
  );
}

export function GovernanceTableScroll({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-600"
    >
      <table className="w-full min-w-[1100px] border-collapse text-left text-sm">{children}</table>
    </div>
  );
}

export function GovernanceTableHead({ children }: { children: ReactNode }) {
  return (
    <thead className="bg-slate-100 text-slate-700">
      <tr>{children}</tr>
    </thead>
  );
}
export function GovernanceTh({ children }: { children: ReactNode }) {
  return (
    <th scope="col" className="whitespace-nowrap border-b border-slate-200 px-3 py-3 font-medium">
      {children}
    </th>
  );
}
export function GovernanceTd({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <td className={`border-b border-slate-200 px-3 py-3 align-top text-slate-800 ${className}`}>
      {children}
    </td>
  );
}
export function GovernanceCell({
  primary,
  secondary,
}: {
  primary: ReactNode;
  secondary?: ReactNode;
}) {
  return (
    <div className="min-w-28">
      <div className="max-w-56 font-medium text-slate-900 [overflow-wrap:anywhere]">{primary}</div>
      {secondary ? (
        <div className="mt-1 max-w-56 text-xs leading-5 text-slate-600">{secondary}</div>
      ) : null}
    </div>
  );
}
export function GovernanceStatus({ value }: { value: string }) {
  const tone = /approved|retained|confirmed|revoked/i.test(value)
    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
    : /reject|overdue|fail/i.test(value)
      ? "border-red-200 bg-red-50 text-red-900"
      : /pending|awaiting|change/i.test(value)
        ? "border-amber-200 bg-amber-50 text-amber-950"
        : "border-blue-200 bg-blue-50 text-blue-900";
  return (
    <span className={`inline-flex rounded px-2 py-1 text-xs font-medium ${tone}`}>
      {value.replaceAll("_", " ")}
    </span>
  );
}
export function GovernancePagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-3 py-3 text-sm text-slate-600">
      <span>
        {total === 0
          ? "No records"
          : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total.toLocaleString()}`}
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          <ChevronLeft className="h-4 w-4" />
          Previous
        </Button>
        <span aria-live="polite">
          Page {page} of {pages}
        </span>
        <Button
          variant="outline"
          size="sm"
          aria-label="Next page"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          Next
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
export function GovernanceLoading({ label }: { label: string }) {
  return (
    <div role="status" className="flex items-center gap-2 p-6 text-sm text-slate-600">
      <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
      Loading {label}…
    </div>
  );
}
export function GovernanceEmpty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="px-5 py-12 text-center">
      <p className="font-medium text-slate-900">{title}</p>
      <p className="mt-1 text-sm text-slate-600">{detail}</p>
    </div>
  );
}
export function GovernanceError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-5 text-red-950">
      <div className="flex gap-2 font-medium">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        Governance data is unavailable
      </div>
      <p className="mt-2 text-sm">{message}</p>
      <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
        <RefreshCw className="mr-2 h-4 w-4" />
        Try again
      </Button>
    </div>
  );
}
export function GovernanceFootnote({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-xs leading-5 text-slate-600">{children}</p>;
}
export function formatGovernanceTime(
  value: string | null,
  options: Intl.DateTimeFormatOptions = {},
) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? "Invalid timestamp"
    : new Intl.DateTimeFormat("en-IN", {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "Asia/Kolkata",
        ...options,
      }).format(date);
}
export function newGovernanceIdempotencyKey() {
  return globalThis.crypto.randomUUID();
}
export function getGovernanceIntentKey(scope: string, fingerprintValue: unknown) {
  const storageKey = `fvi-governance-intent:${scope}`;
  const fingerprint = JSON.stringify(fingerprintValue);
  const key = globalThis.localStorage?.getItem(storageKey);
  const knownFingerprint = globalThis.sessionStorage?.getItem(`${storageKey}:fingerprint`);
  if (key && knownFingerprint && knownFingerprint !== fingerprint)
    throw new Error(
      "A previous governance request has an uncertain result. Retry the exact same details before starting a changed request.",
    );
  if (key) {
    globalThis.sessionStorage?.setItem(`${storageKey}:fingerprint`, fingerprint);
    return key;
  }
  const nextKey = newGovernanceIdempotencyKey();
  globalThis.localStorage?.setItem(storageKey, nextKey);
  globalThis.sessionStorage?.setItem(`${storageKey}:fingerprint`, fingerprint);
  return nextKey;
}
export function clearGovernanceIntentKey(scope: string, fingerprintValue: unknown) {
  const storageKey = `fvi-governance-intent:${scope}`;
  const fingerprint = JSON.stringify(fingerprintValue);
  const saved = globalThis.sessionStorage?.getItem(`${storageKey}:fingerprint`);
  if (saved === fingerprint) {
    globalThis.localStorage?.removeItem(storageKey);
    globalThis.sessionStorage?.removeItem(`${storageKey}:fingerprint`);
  }
}
export function storeGovernanceIntentDraft(scope: string, value: unknown) {
  globalThis.sessionStorage?.setItem(`fvi-governance-intent-draft:${scope}`, JSON.stringify(value));
}
export function readGovernanceIntentDraft<T>(scope: string): T | null {
  try {
    const value = globalThis.sessionStorage?.getItem(`fvi-governance-intent-draft:${scope}`);
    return value ? (JSON.parse(value) as T) : null;
  } catch {
    return null;
  }
}
export function clearGovernanceIntentDraft(scope: string) {
  globalThis.sessionStorage?.removeItem(`fvi-governance-intent-draft:${scope}`);
}

export function formatGovernanceEnvironment(value: unknown) {
  const labels: Record<string, string> = {
    prod: "PROD",
    production: "PROD",
    dev: "DEV",
    development: "DEV",
    sandbox: "SANDBOX",
    uat: "UAT",
    staging: "STAGING",
  };
  return typeof value === "string"
    ? (labels[value.toLowerCase()] ?? value)
    : "Environment unavailable";
}

export function GovernanceHistory({ events }: { events: unknown[] }) {
  const rows = events.filter(
    (event): event is Record<string, unknown> =>
      !!event && typeof event === "object" && !Array.isArray(event),
  );
  if (!rows.length) return null;
  const scalar = (value: unknown) =>
    typeof value === "string" || typeof value === "number" ? String(value) : "Not recorded";
  return (
    <section className="mt-5">
      <h3 className="text-sm font-semibold text-slate-950">Decision history</h3>
      <ol className="mt-2 space-y-2">
        {rows.map((event, index) => (
          <li
            key={`${scalar(event.audit_id)}-${index}`}
            className="rounded border border-slate-200 p-3 text-sm"
          >
            <p className="font-medium text-slate-900">
              {scalar(event.action)} · {scalar(event.outcome)} · Version {scalar(event.version)}
            </p>
            <p className="mt-1 text-xs text-slate-600">
              {formatGovernanceTime(
                typeof event.occurred_at === "string" ? event.occurred_at : null,
              )}{" "}
              · {scalar(event.reason)}
            </p>
            <p className="mt-1 break-words text-xs text-slate-600">
              Audit {scalar(event.audit_id)} · Correlation {scalar(event.correlation_id)}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function GovernanceEffectiveScope({
  scope,
}: {
  scope: {
    roles?: unknown[];
    bu_assignments?: unknown[];
    reconciliation_grants?: unknown[];
    data_resource_grants?: unknown[];
    legacy_reconciliation_grants?: unknown[];
    legacy_data_resource_grants?: unknown[];
    resource_grants?: unknown[];
  };
}) {
  const groups: [string, unknown[] | undefined][] = [
    ["Group roles", scope.roles],
    ["Business-unit assignments", scope.bu_assignments],
    ["Reconciliation grants", scope.reconciliation_grants],
    ["Data-resource grants", scope.data_resource_grants],
    ["Existing reconciliation grants", scope.legacy_reconciliation_grants],
    ["Existing data-resource grants", scope.legacy_data_resource_grants],
    ["Group resource grants", scope.resource_grants],
  ];
  const keys = [
    "name",
    "role_name",
    "role_id",
    "id",
    "bu_name",
    "bu_id",
    "workspace_name",
    "workspace_id",
    "resource_type",
    "resource_name",
    "resource_id",
    "recon_id",
    "action",
    "permission_id",
    "scope",
  ];
  return (
    <div className="mt-4 space-y-2">
      {groups
        .filter(([, rows]) => rows?.length)
        .map(([label, rows]) => (
          <details key={label} className="rounded-md border border-slate-200 bg-white p-3">
            <summary className="cursor-pointer text-sm font-medium text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600">
              {label} · {rows!.length}
            </summary>
            <ol className="mt-2 space-y-2">
              {rows!.map((raw, index) => {
                const row =
                  raw && typeof raw === "object" && !Array.isArray(raw)
                    ? (raw as Record<string, unknown>)
                    : {};
                const fields = keys.filter(
                  (key) => typeof row[key] === "string" || typeof row[key] === "number",
                );
                return (
                  <li
                    key={index}
                    className="break-words rounded bg-slate-50 p-3 text-xs text-slate-800"
                  >
                    {fields.length ? (
                      <dl className="grid gap-2 sm:grid-cols-2">
                        {fields.map((key) => (
                          <div key={key}>
                            <dt className="font-medium text-slate-600">
                              {key.replaceAll("_", " ")}
                            </dt>
                            <dd className="mt-0.5 [overflow-wrap:anywhere]">{String(row[key])}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : (
                      "Detailed labels unavailable in this scoped snapshot."
                    )}
                  </li>
                );
              })}
            </ol>
          </details>
        ))}
    </div>
  );
}
