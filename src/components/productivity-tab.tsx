import { useMemo, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BreakGridEditor } from "@/components/break-grid-editor";
import { PivotPanel, type PivotConfig } from "@/components/pivot-panel";
import { SavedViewsBar, type ViewType } from "@/components/saved-views-bar";
import { DocumentSplitViewer, type ExtractedField, type LinkedBreak } from "@/components/document-split-viewer";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Sigma, GroupIcon, FileText, Smartphone, ExternalLink, Sparkles } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { resolvePdfSource } from "@/lib/pdf-source";
import { createPdfDocumentExceptionLink, readPdfDocumentExceptionLinks } from "@/lib/pdf-document-exception-links";

export function guardProductivityPivot(value: unknown, mixedCurrencies: boolean): PivotConfig | null {
  if (!isRecord(value) || !Array.isArray(value.rowFields)) return null;
  const fields = ["status", "category", "counterparty", "currency", "severity", "assigned_to", "amount", "age_days"];
  if (!value.rowFields.every((field) => typeof field === "string" && fields.includes(field))) return null;
  if (value.colField != null && (typeof value.colField !== "string" || !fields.includes(value.colField))) return null;
  if (value.valueField != null && !["amount", "age_days"].includes(String(value.valueField))) return null;
  if (value.agg != null && !["sum", "avg", "count", "min", "max"].includes(String(value.agg))) return null;
  const rowFields = [...new Set(value.rowFields as string[])];
  if (mixedCurrencies && value.valueField === "amount" && value.agg !== "count" && value.colField !== "currency" && !rowFields.includes("currency")) rowFields.push("currency");
  return { rowFields, colField: value.colField as string | null | undefined, valueField: value.valueField as string | null | undefined, agg: value.agg as PivotConfig["agg"] };
}

export interface ProductivityException {
  status: string;
  severity: string;
  category: string;
  counterparty: string;
  currency: string;
  amount: number | null;
  age_days: number | null;
  assigned_to: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function displayValue(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function finiteAmount(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Normalize untrusted row/payload fields without turning missing metrics into zero. */
export function normalizeProductivityExceptions(value: unknown, now = Date.now()): ProductivityException[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((candidate): ProductivityException[] => {
    if (!isRecord(candidate)) return [];
    if (!["status", "severity", "priority", "assignee", "payload", "created_at"].some((key) => key in candidate)) return [];
    const payload = isRecord(candidate.payload) ? candidate.payload : {};
    const timestamp = typeof candidate.created_at === "string" ? Date.parse(candidate.created_at) : Number.NaN;
    const ageDays = Number.isFinite(timestamp) && timestamp <= now
      ? Math.floor((now - timestamp) / 86_400_000)
      : null;

    return [{
      status: displayValue(candidate.status, "Unknown"),
      severity: displayValue(candidate.severity, "Unknown"),
      category: displayValue(payload.category, displayValue(payload.break_type, displayValue(candidate.priority, "Uncategorised"))),
      counterparty: displayValue(payload.counterparty, displayValue(payload.cpty, "—")),
      currency: displayValue(payload.currency, displayValue(payload.ccy, "—")),
      amount: finiteAmount(payload.amount ?? payload.value),
      age_days: ageDays,
      assigned_to: displayValue(candidate.assignee, "Unassigned"),
    }];
  });
}

/** Flatten only scalar persisted extraction values; nested data is not a display field. */
export function productivityExtractedFields(value: unknown): ExtractedField[] {
  if (!isRecord(value)) return [];
  return Object.entries(value)
    .flatMap(([label, entry], index): ExtractedField[] => {
      if (typeof entry !== "string" && typeof entry !== "number") return [];
      return [{ key: label + "-" + index, label, value: entry }];
    })
    .slice(0, 40);
}

export interface ProductivityTabProps {
  tenantId: string;
}

/**
 * UX/Productivity v2 hub:
 *  - Excel-like grid for ad-hoc break analysis with formula bar
 *  - Pivot / group-by over live exceptions
 *  - Saved views (personal + shared) wired to the pivot/grid
 *  - Side-by-side document viewer (PDF | extracted fields | break)
 *  - Mobile approver app entry point
 */
export function ProductivityTab({ tenantId }: ProductivityTabProps) {
  const [viewType, setViewType] = useState<ViewType>("pivot");
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [selectedExceptionId, setSelectedExceptionId] = useState("");
  const [confirmedVisibleSource, setConfirmedVisibleSource] = useState<{ documentId: string; url: string } | null>(null);
  const [linkWritePending, setLinkWritePending] = useState(false);
  const [linkFeedback, setLinkFeedback] = useState<string | null>(null);
  const isSplitView = viewType !== "grid" && viewType !== "pivot";
  // Load a slice of exceptions to power the pivot demo
  const { data: exceptions = [], isLoading, isFetching: refreshingExceptions, isError: exceptionListError, refetch: retryExceptionList } = useQuery({
    queryKey: ["productivity-exceptions", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recon_exceptions")
        .select("id, public_case_id, status, severity, priority, side, assignee, payload, created_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      const normalized = normalizeProductivityExceptions(data ?? []);
      return normalized.map((row, index) => ({ ...row, id: data![index].id,
        reference: data![index].public_case_id ?? "Case ID unavailable" }));
    },
  });

  // Keep document identity separate from the expiring signed source. The
  // tenant filter and Storage RLS authorize both reads; only the selected
  // document's canonical tenant/document source path is ever signed.
  const { data: aidpDocuments = [], isPending: isPendingDocuments, isError: documentListError, refetch: retryDocumentList } = useQuery({
    queryKey: ["productivity-aidp-documents", tenantId],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("aidp_documents")
        .select("id, public_id, original_filename, page_count, status, extraction, created_at")
        .eq("tenant_id", tenantId)
        .eq("mime", "application/pdf")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });
  const selectedDocument = aidpDocuments.find((doc: any) => doc.id === selectedDocumentId) ?? aidpDocuments[0] ?? null;
  const documentLinksQuery = useQuery({
    queryKey: ["productivity-pdf-document-exception-links", tenantId, selectedDocument?.id ?? null],
    enabled: !!selectedDocument && isSplitView,
    staleTime: 0,
    refetchOnWindowFocus: isSplitView,
    queryFn: () => readPdfDocumentExceptionLinks(tenantId, selectedDocument!.id),
  });
  const { data: aidpSource, isPending: isPendingPdfSource, isFetching: isFetchingPdfSource, isError: sourceQueryError, refetch: retryPdfSource } = useQuery({
    queryKey: ["productivity-aidp-source", tenantId, selectedDocument?.id ?? null],
    enabled: !!selectedDocument,
    staleTime: 0,
    refetchInterval: isSplitView ? 12 * 60_000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: isSplitView,
    queryFn: async () => {
      try {
        if (!selectedDocument) return { pdfUrl: null, sourceUnavailable: false };
        const path = `${tenantId}/${selectedDocument.id}/source.pdf`;
        const { data: signed, error } = await supabase.storage.from("aidp").createSignedUrl(path, 900);
        const resolved = resolvePdfSource(signed, error);
        return resolved.status === "available"
          ? { pdfUrl: resolved.url, sourceUnavailable: false }
          : { pdfUrl: null, sourceUnavailable: true };
      } catch {
        return { pdfUrl: null, sourceUnavailable: true };
      }
    },
  });
  const refreshPdfSource = () => {
    setConfirmedVisibleSource(null);
    return retryPdfSource({ cancelRefetch: false });
  };

  const fields = useMemo<ExtractedField[]>(() => {
    const ex = (selectedDocument?.extraction ?? {}) as Record<string, any>;
    const flat: ExtractedField[] = [];
    Object.entries(ex).forEach(([k, v], i) => {
      if (v === null || typeof v === "object") return;
      flat.push({ key: `${k}-${i}`, label: k, value: v as any, confidence: undefined, page: 1, bbox: undefined });
    });
    return flat.slice(0, 40);
  }, [selectedDocument]);

  const persistedLinks = documentLinksQuery.data?.status === "available" ? documentLinksQuery.data.links : [];
  const linkedBreaks: LinkedBreak[] = persistedLinks.map((link) => ({
    id: link.id,
    reference: link.reference,
    amount: link.amount ?? undefined,
    currency: link.currency ?? undefined,
    status: link.status ?? undefined,
    ageDays: link.ageDays ?? undefined,
    category: link.category ?? undefined,
  }));
  const associationState = documentLinksQuery.isPending || documentLinksQuery.isFetching
    ? "loading"
    : documentLinksQuery.isError || documentLinksQuery.data?.status === "unavailable"
      ? "unavailable"
      : persistedLinks.length > 0
        ? "linked"
        : "empty";
  const selectedDocumentHasPublicId = typeof selectedDocument?.public_id === "string" && /^FVI-AIDPD-[A-F0-9]{20}$/.test(selectedDocument.public_id);
  const linkableExceptions = exceptions.filter((exception: any) => typeof exception.reference === "string" && /^FVI-EXC-[A-F0-9]{32}$/.test(exception.reference));
  const pdfSourceResolved = !!aidpSource?.pdfUrl && !isFetchingPdfSource && !sourceQueryError && !aidpSource.sourceUnavailable;
  const visibleSourceConfirmed = !!selectedDocument && !!aidpSource?.pdfUrl
    && confirmedVisibleSource?.documentId === selectedDocument.id
    && confirmedVisibleSource?.url === aidpSource.pdfUrl;

  const saveSelectedExceptionLink = async () => {
    if (!selectedDocumentHasPublicId || !selectedDocument || !selectedExceptionId || !pdfSourceResolved || !visibleSourceConfirmed || linkWritePending) return;
    setLinkWritePending(true);
    setLinkFeedback(null);
    try {
      const result = await createPdfDocumentExceptionLink({
        tenantId,
        documentId: selectedDocument.id,
        exceptionId: selectedExceptionId,
      });
      if (result.status === "linked") {
        setSelectedExceptionId("");
        const readback = await documentLinksQuery.refetch();
        const verified = readback.data?.status === "available" && readback.data.links.some((link) => link.exceptionId === selectedExceptionId);
        setLinkFeedback(verified
          ? "Association saved and confirmed for the selected document and exception."
          : "The link request succeeded, but its association could not be verified. Refresh before retrying.");
      } else if (result.status === "already-linked") {
        setSelectedExceptionId("");
        const readback = await documentLinksQuery.refetch();
        const verified = readback.data?.status === "available" && readback.data.links.some((link) => link.exceptionId === selectedExceptionId);
        setLinkFeedback(verified
          ? "That exception is already linked to this document."
          : "An association already exists, but it could not be verified. Refresh before retrying.");
      } else {
        setLinkFeedback("Could not save the association. Check access and try again.");
      }
    } catch {
      setLinkFeedback("Could not save the association. Check access and try again.");
    } finally {
      setLinkWritePending(false);
    }
  };

  // Pivot / saved-view state
  const [pivot, setPivot] = useState<PivotConfig>({
    rowFields: ["currency", "category"],
    colField: "status",
    valueField: null,
    agg: "count",
  });

  const pivotFields = useMemo(() => [
    { key: "status", label: "Status", type: "string" as const },
    { key: "category", label: "Category", type: "string" as const },
    { key: "counterparty", label: "Counterparty", type: "string" as const },
    { key: "currency", label: "Currency", type: "string" as const },
    { key: "severity", label: "Severity", type: "string" as const },
    { key: "assigned_to", label: "Assignee", type: "string" as const },
    { key: "amount", label: "Amount", type: "number" as const },
    { key: "age_days", label: "Age (days)", type: "number" as const },
  ], []);

  const initialGrid = useMemo(() => {
    const rows: (string | number | null)[][] = [
      ["Reference", "Counterparty", "Currency", "Amount", "Age", "Status", "Notes"],
    ];
    exceptions.slice(0, 20).forEach((e: any) =>
      rows.push([
        e.reference,
        e.counterparty ?? "",
        e.currency ?? "",
        e.amount ?? null,
        e.age_days ?? null,
        e.status ?? "",
        "",
      ]),
    );
    // Add a totals row using formulas
    const last = rows.length + 1; // 1-indexed
    rows.push(["Totals", "", "", new Set(exceptions.map(e => e.currency)).size > 1 ? "Separate currencies" : `=SUM(D2:D${last - 1})`, `=AVG(E2:E${last - 1})`, `=COUNTA(F2:F${last - 1})`, ""]);
    return rows;
  }, [exceptions]);

  const initialGridCols = ["Reference", "Counterparty", "Currency", "Amount", "Age (d)", "Status", "Notes"];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              Productivity Suite
            </CardTitle>
            <CardDescription className="mt-1">
              Excel-like grids · pivot · saved views · side-by-side doc viewer · mobile approver
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <SavedViewsBar
              tenantId={tenantId}
              scope="productivity"
              currentFilters={{}}
              currentPivot={pivot as any}
              viewType={viewType}
              onApply={(v) => {
                if (v.pivot_config && Object.keys(v.pivot_config).length) { const config = guardProductivityPivot(v.pivot_config, new Set(exceptions.map(e => e.currency)).size > 1); if (config) setPivot(config); }
                if (v.view_type) {
                  setViewType(v.view_type);
                  if (v.view_type !== "grid" && v.view_type !== "pivot") void refreshPdfSource();
                }
              }}
            />
            <Button asChild variant="outline" size="sm">
              <Link to="/m/approvals">
                <Smartphone className="h-4 w-4 mr-1" />
                Mobile approver
                <ExternalLink className="h-3 w-3 ml-1" />
              </Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <Badge variant="outline">{exceptionListError ? "Exceptions unavailable" : isLoading || refreshingExceptions ? "Loading exceptions…" : `${exceptions.length} exceptions loaded (limit 500)`}</Badge>
            <Badge variant="outline">{documentListError ? "Extraction unavailable" : isPendingDocuments ? "Loading extraction…" : `${fields.length} recorded extracted fields`}</Badge>
            <Badge variant="outline">View: {viewType}</Badge>
          </div>
        </CardContent>
      </Card>

      <Tabs value={viewType === "grid" ? "grid" : viewType === "pivot" ? "pivot" : "split"} onValueChange={(v) => {
        setViewType(v as ViewType);
        if (v === "split") void refreshPdfSource();
      }}>
        <TabsList>
          <TabsTrigger value="pivot"><GroupIcon className="h-4 w-4 mr-1" />Pivot</TabsTrigger>
          <TabsTrigger value="grid"><Sigma className="h-4 w-4 mr-1" />Grid editor</TabsTrigger>
          <TabsTrigger value="split"><FileText className="h-4 w-4 mr-1" />Side-by-side viewer</TabsTrigger>
        </TabsList>

        <TabsContent value="pivot" className="mt-3">
          {exceptionListError ? <div role="alert"><p>Exception records could not be loaded. Retry before analysis.</p><Button onClick={() => void retryExceptionList()}>Retry exceptions</Button></div> : isLoading || refreshingExceptions ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground">Loading exceptions…</CardContent></Card>
          ) : (
            <PivotPanel rows={exceptions as any[]} fields={pivotFields} config={pivot} onConfigChange={value => { const config = guardProductivityPivot(value, new Set(exceptions.map(e => e.currency)).size > 1); if (config) setPivot(config); }} />
          )}
        </TabsContent>

        <TabsContent value="grid" className="mt-3">
          {exceptionListError || isLoading || refreshingExceptions ? <p role={exceptionListError ? "alert" : "status"}>Worksheet unavailable until exception records are loaded. Refresh the exception list.</p> : <BreakGridEditor
            title="Break investigation worksheet"
            initialRows={initialGrid}
            initialColumns={initialGridCols}
            rows={Math.max(40, initialGrid.length + 5)}
            cols={initialGridCols.length}
          />}
        </TabsContent>

        <TabsContent value="split" className="mt-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-sm">
            <label className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">Source document</span>
              <select
                aria-label="Select source document"
                className="h-9 max-w-full rounded-md border bg-background px-3"
                value={selectedDocument?.id ?? ""}
                disabled={isPendingDocuments || aidpDocuments.length === 0}
                onChange={(event) => {
                  setSelectedDocumentId(event.currentTarget.value || null);
                  setSelectedExceptionId("");
                  setConfirmedVisibleSource(null);
                  setLinkFeedback(null);
                }}
              >
                {isPendingDocuments && <option value="">Loading documents…</option>}
                {!isPendingDocuments && aidpDocuments.length === 0 && <option value="">No documents available</option>}
                {aidpDocuments.map((doc: any) => (
                  <option key={doc.id} value={doc.id}>
                    {doc.original_filename} · {doc.public_id ?? "Document ID unavailable"}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex gap-2">
              {documentListError && <Button type="button" size="sm" variant="outline" onClick={() => void retryDocumentList()}>Retry list</Button>}
              <Button type="button" size="sm" variant="outline" onClick={() => void refreshPdfSource()} disabled={!selectedDocument || isFetchingPdfSource}>
              {isFetchingPdfSource ? "Refreshing…" : "Refresh source"}
              </Button>
            </div>
          </div>
          <label className="mb-3 flex items-start gap-2 rounded-md border p-3 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              aria-label="Confirm selected PDF page is visible"
              checked={visibleSourceConfirmed}
              disabled={!pdfSourceResolved}
              onChange={(event) => setConfirmedVisibleSource(event.currentTarget.checked && selectedDocument && aidpSource?.pdfUrl
                ? { documentId: selectedDocument.id, url: aidpSource.pdfUrl }
                : null)}
            />
            <span>
              I can see the selected PDF page above. If the frame is blank, use Open original or refresh the source, then confirm only after the page is visible.
            </span>
          </label>
          <div className="mb-3 flex flex-wrap items-end gap-3 rounded-md border p-3 text-sm">
            <div className="min-w-[16rem] flex-1 space-y-1">
              <label htmlFor="pdf-exception-link-target" className="font-medium">Link a visible exception</label>
              <select
                id="pdf-exception-link-target"
                aria-label="Select exception to link"
                className="h-9 w-full rounded-md border bg-background px-3"
                value={selectedExceptionId}
                disabled={!selectedDocumentHasPublicId || !pdfSourceResolved || isLoading || exceptionListError || linkableExceptions.length === 0}
                onChange={(event) => {
                  setSelectedExceptionId(event.currentTarget.value);
                  setLinkFeedback(null);
                }}
              >
                <option value="">Choose an exception…</option>
                {linkableExceptions.map((exception: any) => (
                  <option key={exception.id} value={exception.id}>
                    {exception.reference} · {exception.category} · {exception.status}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">Only exceptions returned by this tenant-scoped list with a public case ID can be selected. Nothing is linked automatically.</p>
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={!selectedDocumentHasPublicId || !pdfSourceResolved || !visibleSourceConfirmed || !selectedExceptionId || linkWritePending || documentLinksQuery.isFetching || documentLinksQuery.isError || documentLinksQuery.data?.status === "unavailable"}
              onClick={() => void saveSelectedExceptionLink()}
            >
              {linkWritePending ? "Saving link…" : "Link selected exception"}
            </Button>
            {linkFeedback && <p role="status" className="w-full text-xs text-muted-foreground">{linkFeedback}</p>}
            {!isPendingDocuments && selectedDocument && !selectedDocumentHasPublicId && <p className="w-full text-xs text-muted-foreground">This document has no valid public identifier and cannot be linked.</p>}
            {exceptionListError && <p role="alert" className="w-full text-xs text-muted-foreground">Exception records could not be loaded. Retry before creating a link.</p>}
            {documentLinksQuery.data?.status === "unavailable" && <p role="alert" className="w-full text-xs text-muted-foreground">Saved document links could not be verified. Refresh to check before adding another.</p>}
            {!isLoading && !exceptionListError && linkableExceptions.length === 0 && <p className="w-full text-xs text-muted-foreground">No visible exceptions with a public case ID are available to link.</p>}
          </div>
          {(documentListError || sourceQueryError || aidpSource?.sourceUnavailable) && (
            <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/30 p-3 text-sm">
              <div>
                <p className="font-medium">Source document could not be opened.</p>
                <p className="text-muted-foreground">Its availability could not be confirmed. Try again to check the source.</p>
              </div>
              <Button type="button" size="sm" variant="outline" onClick={() => documentListError ? void retryDocumentList() : void refreshPdfSource()} disabled={isFetchingPdfSource || isPendingDocuments}>
                {isFetchingPdfSource ? "Checking…" : "Try again"}
              </Button>
            </div>
          )}
          {exceptionListError && (
            <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/30 p-3 text-sm">
              <span>Exception records could not be checked for this tenant.</span>
              <Button type="button" size="sm" variant="outline" onClick={() => void retryExceptionList()}>Retry exceptions</Button>
            </div>
          )}
          <DocumentSplitViewer
            pdfUrl={aidpSource?.pdfUrl ?? null}
            documentName={isPendingDocuments || (!!selectedDocument && isPendingPdfSource) ? "Loading document…" : documentListError ? "Documents unavailable" : selectedDocument?.original_filename ?? "No document loaded"}
            sourceLoading={isPendingDocuments || (!!selectedDocument && isPendingPdfSource)}
            sourceUnavailable={!!aidpSource?.sourceUnavailable}
            documentListUnavailable={documentListError}
            documentUnavailable={!isPendingDocuments && !documentListError && !selectedDocument}
            onSourceRetry={() => void refreshPdfSource()}
            fields={documentListError || isPendingDocuments ? [] : fields}
            linkedBreaks={linkedBreaks}
            associationState={associationState}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
