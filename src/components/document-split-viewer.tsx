import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileText, MapPin, ArrowLeftRight, Maximize2, Download } from "lucide-react";

export interface ExtractedField {
  key: string;
  label: string;
  value: string | number | null;
  confidence?: number;
  page?: number;
  bbox?: [number, number, number, number]; // [x,y,w,h] in PDF coords
}

export interface LinkedBreak {
  id: string;
  reference: string;
  amount?: number;
  currency?: string;
  status?: string;
  ageDays?: number;
  category?: string;
  notes?: string;
}

export interface DocumentSplitViewerProps {
  pdfUrl?: string | null;
  pdfUnavailableMessage?: string;
  documentName?: string;
  fields: ExtractedField[];
  break_?: LinkedBreak | null;
  onFieldClick?: (field: ExtractedField) => void;
  sourceLoading?: boolean;
  sourceUnavailable?: boolean;
  documentListUnavailable?: boolean;
  documentUnavailable?: boolean;
  onSourceRetry?: () => void;
  linkedBreaks?: LinkedBreak[];
  associationState?: "loading" | "unavailable" | "linked" | "empty" | string;
}

export function DocumentSplitViewer({
  pdfUrl,
  pdfUnavailableMessage,
  documentName,
  fields,
  break_,
  onFieldClick,
  sourceLoading,
  sourceUnavailable,
  documentListUnavailable,
  documentUnavailable,
  onSourceRetry,
  linkedBreaks,
  associationState,
}: DocumentSplitViewerProps) {
  const [activeField, setActiveField] = useState<string | null>(null);
  const [fullPdf, setFullPdf] = useState(false);

  return (
    <div className={`grid gap-4 ${fullPdf ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-3"}`}>
      {/* PDF panel */}
      <Card className={`${fullPdf ? "" : "lg:col-span-2"} flex flex-col`}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            {documentName || "Source document"}
          </CardTitle>
          <div className="flex gap-2">
            {pdfUrl && (
              <Button variant="outline" size="sm" asChild>
                <a href={pdfUrl} download><Download className="h-4 w-4 mr-1" />Download</a>
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => setFullPdf((v) => !v)} disabled={!pdfUrl} aria-label="Toggle full document view">
              <Maximize2 className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex-1 p-0 min-h-[60vh]">
          {pdfUrl ? (
            <iframe
              src={pdfUrl}
              title="source-pdf"
              className="w-full h-[70vh] border-t"
            />
          ) : (
            <div role="status" className="h-full grid place-items-center text-muted-foreground text-sm border-t">
              <div className="text-center space-y-2 p-8">
                <FileText className="h-10 w-10 mx-auto opacity-40" />
                <p>{sourceLoading
                  ? "Loading source document…"
                  : documentListUnavailable
                    ? "The document list is unavailable right now."
                    : sourceUnavailable
                      ? (pdfUnavailableMessage ?? "The source document could not be confirmed available.")
                      : documentUnavailable
                        ? "No document is selected."
                        : (pdfUnavailableMessage ?? "No source document is available in this view.")}</p>
                {onSourceRetry && !sourceLoading && (
                  <Button type="button" size="sm" variant="outline" onClick={onSourceRetry}>
                    Try again
                  </Button>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {!fullPdf && (
        <div className="flex flex-col gap-4">
          {/* Extracted fields */}
          <Card className="flex-1">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <ArrowLeftRight className="h-4 w-4 text-primary" />
                Extracted fields
                <Badge variant="outline" className="ml-auto">{fields.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[30vh]">
                <div className="divide-y">
                  {fields.length === 0 ? (
                    <p className="px-4 py-8 text-center text-muted-foreground text-sm">No extracted fields were returned for this document.</p>
                  ) : fields.map((f) => {
                    const isActive = activeField === f.key;
                    const conf = f.confidence != null ? Math.round(f.confidence * 100) : null;
                    return (
                      <button
                        key={f.key}
                        onClick={() => { setActiveField(f.key); onFieldClick?.(f); }}
                        className={`w-full text-left px-4 py-2 hover:bg-muted/50 transition-colors ${isActive ? "bg-primary/5 border-l-2 border-l-primary" : ""}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium text-muted-foreground truncate">{f.label}</span>
                          <div className="flex items-center gap-1">
                            {f.page != null && <Badge variant="outline" className="text-[10px]"><MapPin className="h-2.5 w-2.5 mr-0.5" />p{f.page}</Badge>}
                            {conf != null && (
                              <Badge variant={conf >= 90 ? "default" : conf >= 70 ? "secondary" : "destructive"} className="text-[10px]">
                                {conf}%
                              </Badge>
                            )}
                          </div>
                        </div>
                        <div className="text-sm font-mono mt-0.5 truncate">
                          {f.value == null || f.value === "" ? <span className="text-muted-foreground italic">empty</span> : String(f.value)}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Linked break */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Linked break</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {linkedBreaks ? (
                associationState === "loading" ? (
                  <p className="text-muted-foreground text-sm py-4 text-center">Checking linked exceptions…</p>
                ) : associationState === "unavailable" ? (
                  <p className="text-muted-foreground text-sm py-4 text-center">Linked-exception status is unavailable right now.</p>
                ) : linkedBreaks.length === 0 ? (
                  <p className="text-muted-foreground text-sm py-4 text-center">No exceptions are linked to this document yet.</p>
                ) : (
                  <div className="divide-y">
                    {linkedBreaks.map((b) => (
                      <div key={b.id} className="py-2 space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground text-xs">Reference</span>
                          <span className="font-mono">{b.reference}</span>
                        </div>
                        {b.amount != null && (
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground text-xs">Amount</span>
                            <span className="font-mono font-semibold">
                              {b.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })} {b.currency ?? ""}
                            </span>
                          </div>
                        )}
                        {b.status && (
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground text-xs">Status</span>
                            <Badge variant="outline">{b.status}</Badge>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )
              ) : break_ ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground text-xs">Reference</span>
                    <span className="font-mono">{break_.reference}</span>
                  </div>
                  {break_.amount != null && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground text-xs">Amount</span>
                      <span className="font-mono font-semibold">
                        {break_.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })} {break_.currency ?? ""}
                      </span>
                    </div>
                  )}
                  {break_.status && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground text-xs">Status</span>
                      <Badge variant="outline">{break_.status}</Badge>
                    </div>
                  )}
                  {break_.ageDays != null && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground text-xs">Age</span>
                      <span>{break_.ageDays} days</span>
                    </div>
                  )}
                  {break_.category && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground text-xs">Category</span>
                      <Badge variant="secondary">{break_.category}</Badge>
                    </div>
                  )}
                  {break_.notes && (
                    <div className="pt-2 border-t">
                      <p className="text-xs text-muted-foreground mb-1">Notes</p>
                      <p className="text-sm">{break_.notes}</p>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-muted-foreground text-sm py-4 text-center">A related exception was not loaded for this document view.</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
