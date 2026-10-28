import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import {
  listAidpTemplates, upsertAidpTemplate, deleteAidpTemplate,
  listAidpDocuments, createAidpDocument, approveAidpDocument,
} from "@/lib/aidp.functions";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FileText, Upload, Check, Trash2, Plus, History, PencilRuler, Search, Layers, RefreshCw, X, Info } from "lucide-react";
import { toast } from "sonner";
import { ExtractionAuditTimeline } from "@/components/aidp/extraction-audit-timeline";
import { getResourceAccessSummaries } from "@/lib/resource-access-summaries.functions";
import { ResourceIdentitySummary } from "@/components/resource-identity-summary";
import { getResourceActorSummaries } from "@/lib/resource-actor-summaries.functions";
import { ResourceActorSummary } from "@/components/resource-actor-summary";
import { FviDetailDialogLayout } from "@/components/fvi-detail-dialog-layout";

const DOC_KINDS = ["generic", "bank_statement", "trade_confirm", "invoice", "custodian_report"] as const;
const PAGE_SIZE = 10;
const STATUS_OPTIONS = ["all", "queued", "extracting", "review", "approved", "failed"] as const;

function StateMessage({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return <div className="flex flex-col items-center gap-1 px-4 py-8 text-center">
    <FileText aria-hidden="true" className="mb-2 h-8 w-8 text-muted-foreground/60" />
    <p className="font-medium">{title}</p><p className="max-w-lg text-sm text-muted-foreground">{body}</p>{action}
  </div>;
}

function PageControls({ page, total, onPage }: { page: number; total: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return <div className="flex items-center justify-between border-t px-4 py-3 text-sm text-muted-foreground">
    <span>{total === 0 ? "0 results" : `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, total)} of ${total}`}</span>
    <div className="flex gap-2"><Button size="sm" variant="outline" disabled={page === 0} onClick={() => onPage(page - 1)}>Previous</Button>
      <Button size="sm" variant="outline" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>Next</Button></div>
  </div>;
}

export function AidpTab({ tenantId, tenantSlug, canWrite }: { tenantId: string; tenantSlug: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const listT = useServerFn(listAidpTemplates);
  const upT = useServerFn(upsertAidpTemplate);
  const delT = useServerFn(deleteAidpTemplate);
  const listD = useServerFn(listAidpDocuments);
  const createD = useServerFn(createAidpDocument);
  const approveD = useServerFn(approveAidpDocument);
  const getAccessSummaries = useServerFn(getResourceAccessSummaries);
  const getActorSummaries = useServerFn(getResourceActorSummaries);

  const [tplSearch, setTplSearch] = useState("");
  const [tplPublicIdSearch, setTplPublicIdSearch] = useState("");
  const [tplCreatedFrom, setTplCreatedFrom] = useState("");
  const [tplCreatedTo, setTplCreatedTo] = useState("");
  const [tplKind, setTplKind] = useState<string>("all");
  const [tplPage, setTplPage] = useState(0);
  const [docSearch, setDocSearch] = useState("");
  const [docPublicIdSearch, setDocPublicIdSearch] = useState("");
  const [docCreatedFrom, setDocCreatedFrom] = useState("");
  const [docCreatedTo, setDocCreatedTo] = useState("");
  const [docStatus, setDocStatus] = useState<(typeof STATUS_OPTIONS)[number]>("all");
  const [docPage, setDocPage] = useState(0);
  const [docPublicIdReadyFor, setDocPublicIdReadyFor] = useState<string | null>(null);
  const [templatePublicIdReadyFor, setTemplatePublicIdReadyFor] = useState<string | null>(null);
  const [tplOpen, setTplOpen] = useState(false);
  const [tpl, setTpl] = useState<{ name: string; doc_kind: typeof DOC_KINDS[number]; sample_prompt: string }>({ name: "", doc_kind: "generic", sample_prompt: "" });
  const [tplPick, setTplPick] = useState("");
  const [tplPickLabel, setTplPickLabel] = useState("");
  const [tplOptionSearch, setTplOptionSearch] = useState("");
  const [tplOptionPage, setTplOptionPage] = useState(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [auditDocId, setAuditDocId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const newTemplateButtonRef = useRef<HTMLButtonElement | null>(null);

  const tQ = useQuery({
    queryKey: ["aidp-tpl", tenantId, tplPage, tplSearch, tplPublicIdSearch, tplCreatedFrom, tplCreatedTo, tplKind],
    queryFn: () => listT({ data: { tenant_id: tenantId, page: tplPage, page_size: PAGE_SIZE, search: tplSearch, public_id_search: templatePublicIdReadyFor === tenantId ? tplPublicIdSearch : "", created_from: tplCreatedFrom, created_to: tplCreatedTo, kind: tplKind as "all" | typeof DOC_KINDS[number] } }),
    enabled: !tplCreatedFrom || !tplCreatedTo || tplCreatedFrom <= tplCreatedTo,
  });
  const templateOptionsQ = useQuery({
    queryKey: ["aidp-tpl-options", tenantId, tplOptionPage, tplOptionSearch],
    queryFn: () => listT({ data: { tenant_id: tenantId, page: tplOptionPage, page_size: PAGE_SIZE, search: tplOptionSearch, kind: "all" } }),
  });
  const dQ = useQuery({
    queryKey: ["aidp-docs", tenantId, docPage, docSearch, docPublicIdSearch, docCreatedFrom, docCreatedTo, docStatus],
    queryFn: () => listD({ data: { tenant_id: tenantId, page: docPage, page_size: PAGE_SIZE, search: docSearch, public_id_search: docPublicIdReadyFor === tenantId ? docPublicIdSearch : "", created_from: docCreatedFrom, created_to: docCreatedTo, status: docStatus } }),
    enabled: !docCreatedFrom || !docCreatedTo || docCreatedFrom <= docCreatedTo,
  });
  const templates = tQ.data?.rows ?? [];
  const documents = dQ.data?.rows ?? [];
  const docAccessQ = useQuery({
    queryKey: ["resource-access-summary", tenantId, "aidp_document", documents.map((row: any) => row.id)],
    queryFn: () => getAccessSummaries({ data: { resource_type: "aidp_document", resource_ids: documents.map((row: any) => row.id) } }),
    enabled: documents.length > 0,
  });
  const templateAccessQ = useQuery({
    queryKey: ["resource-access-summary", tenantId, "aidp_template", templates.map((row: any) => row.id)],
    queryFn: () => getAccessSummaries({ data: { resource_type: "aidp_template", resource_ids: templates.map((row: any) => row.id) } }),
    enabled: templates.length > 0,
  });
  useEffect(() => { if (docAccessQ.data?.available === true) setDocPublicIdReadyFor(tenantId); }, [docAccessQ.data?.available, tenantId]);
  useEffect(() => { if (templateAccessQ.data?.available === true) setTemplatePublicIdReadyFor(tenantId); }, [templateAccessQ.data?.available, tenantId]);
  const docActorsQ = useQuery({
    queryKey: ["resource-actor-summary", tenantId, "aidp_document", documents.map((row: any) => row.id)],
    queryFn: () => getActorSummaries({ data: { resource_type: "aidp_document", resource_ids: documents.map((row: any) => row.id).slice(0, 100) } }),
    enabled: documents.length > 0,
  });
  const templateActorsQ = useQuery({
    queryKey: ["resource-actor-summary", tenantId, "aidp_template", templates.map((row: any) => row.id)],
    queryFn: () => getActorSummaries({ data: { resource_type: "aidp_template", resource_ids: templates.map((row: any) => row.id).slice(0, 100) } }),
    enabled: templates.length > 0,
  });
  const docAccessById = new Map((docAccessQ.data?.rows ?? []).map((summary) => [summary.resource_id, summary]));
  const templateAccessById = new Map((templateAccessQ.data?.rows ?? []).map((summary) => [summary.resource_id, summary]));
  const docActorsById = new Map((docActorsQ.data?.rows ?? []).map((summary) => [summary.resource_id, summary]));
  const templateActorsById = new Map((templateActorsQ.data?.rows ?? []).map((summary) => [summary.resource_id, summary]));
  const refreshActorSummaries = () => qc.invalidateQueries({ queryKey: ["resource-actor-summary", tenantId] });
  const [viewIdentity, setViewIdentity] = useState<{ kind: "document" | "template"; id: string } | null>(null);
  const viewTriggerRef = useRef<HTMLButtonElement | null>(null);
  const viewTransitionRef = useRef(false);
  const viewedDoc = viewIdentity?.kind === "document" ? documents.find((row: any) => row.id === viewIdentity.id) : null;
  const viewedTemplate = viewIdentity?.kind === "template" ? templates.find((row: any) => row.id === viewIdentity.id) : null;
  const docDateRangeError = Boolean(docCreatedFrom && docCreatedTo && docCreatedFrom > docCreatedTo);
  const templateDateRangeError = Boolean(tplCreatedFrom && tplCreatedTo && tplCreatedFrom > tplCreatedTo);
  const canSearchDocPublicId = docPublicIdReadyFor === tenantId || docAccessQ.data?.available === true;
  const canSearchTemplatePublicId = templatePublicIdReadyFor === tenantId || templateAccessQ.data?.available === true;

  const mTpl = useMutation({
    mutationFn: () => upT({ data: { tenant_id: tenantId, ...tpl, schema: {} } }),
    onSuccess: () => { toast.success("Template saved"); setTplOpen(false); setTpl({ name: "", doc_kind: "generic", sample_prompt: "" }); qc.invalidateQueries({ queryKey: ["aidp-tpl", tenantId] }); qc.invalidateQueries({ queryKey: ["aidp-tpl-options", tenantId] }); refreshActorSummaries(); },
    onError: () => toast.error("Template could not be saved. Check your access and try again."),
  });
  const mDel = useMutation({
    mutationFn: (id: string) => delT({ data: { tenant_id: tenantId, id } }),
    onSuccess: (_result, id) => { toast.success("Template deleted"); qc.invalidateQueries({ queryKey: ["aidp-tpl", tenantId] }); qc.invalidateQueries({ queryKey: ["aidp-tpl-options", tenantId] }); refreshActorSummaries(); if (viewIdentity?.kind === "template" && viewIdentity.id === id) setViewIdentity(null); },
    onError: () => toast.error("Template could not be deleted. Try again or contact your administrator."),
  });
  const mUpload = useMutation({
    mutationFn: async (file: File) => {
      const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
      const isText = !isPdf && (file.type.startsWith("text/") || /\.(csv|txt|json)$/i.test(file.name));
      const text = isText ? await file.text() : "";
      const created = await createD({ data: {
        tenant_id: tenantId, original_filename: file.name, mime: file.type || (isPdf ? "application/pdf" : "application/octet-stream"),
        bytes: file.size, template_id: tplPick || null, content_text: text,
      } });
      if (isPdf) {
        const path = `${tenantId}/${created.id}/source.pdf`;
        const up = await supabase.storage.from("aidp").upload(path, file, { upsert: true, contentType: "application/pdf" });
        if (up.error) throw new Error("PDF storage failed");
      }
      return { ...created, isPdf };
    },
    onSuccess: (r) => { toast.success(`Document recorded · $ ${Number(r.cost_usd).toFixed(4)}${r.isPdf ? " · PDF ready for annotation" : ""}`); setSelectedFile(null); if (fileRef.current) fileRef.current.value = ""; qc.invalidateQueries({ queryKey: ["aidp-docs", tenantId] }); refreshActorSummaries(); },
    onError: () => toast.error("The document could not be processed. Try again or contact your administrator."),
  });
  const mApprove = useMutation({
    mutationFn: (id: string) => approveD({ data: { id, tenant_id: tenantId } }),
    onSuccess: () => { toast.success("Document approved"); qc.invalidateQueries({ queryKey: ["aidp-docs", tenantId] }); refreshActorSummaries(); },
    onError: () => toast.error("Document approval could not be completed. Review pending fields and try again."),
  });

  return <div className="space-y-5">
    <div className="space-y-1">
      <h2 className="text-2xl font-semibold tracking-tight">Document processing</h2>
      <p className="max-w-4xl text-sm text-muted-foreground">Upload a document to extract structured data. A template is optional. Text files use a basic text pass, PDFs can be annotated, and scanned-image OCR is unavailable. AI extraction usage is metered against your AI budget.</p>
    </div>
    <Card>
      <CardContent className="grid gap-5 p-4 sm:p-5 md:grid-cols-2 md:gap-6">
        <section aria-labelledby="aidp-file-heading" className="min-w-0">
          <h3 id="aidp-file-heading" className="mb-3 font-semibold">Document file</h3>
          <div className={`rounded-md border p-3 transition-colors ${selectedFile ? "border-primary bg-primary/5 ring-1 ring-primary/20" : "border-dashed bg-muted/20"}`}>
            {selectedFile ? <div className="mb-3 flex min-w-0 items-center gap-3 rounded-md border bg-card p-3" aria-live="polite">
              <FileText aria-hidden="true" className="h-6 w-6 shrink-0 text-primary" />
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium" title={selectedFile.name}>{selectedFile.name}</p><p className="text-xs text-muted-foreground">{(selectedFile.size / (1024 * 1024)).toFixed(2)} MB</p></div>
              <Button type="button" size="icon" variant="ghost" aria-label="Clear selected file" disabled={mUpload.isPending} onClick={() => { setSelectedFile(null); if (fileRef.current) fileRef.current.value = ""; }}><X className="h-4 w-4" /></Button>
            </div> : null}
            <Input id="aidp-file" ref={fileRef} type="file" className="sr-only" disabled={!canWrite || mUpload.isPending} onChange={(e) => {
              const f = e.target.files?.[0]; if (f) setSelectedFile(f);
            }} />
            <Button type="button" variant="outline" className="w-full" disabled={!canWrite || mUpload.isPending} onClick={() => fileRef.current?.click()}><Upload className="mr-2 h-4 w-4" />{selectedFile ? "Choose a different file" : "Choose file"}</Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Choose a PDF or text-based document. Unsupported content may not produce an extractable preview.</p>
        </section>
        <section aria-labelledby="aidp-options-heading" className="min-w-0">
          <h3 id="aidp-options-heading" className="mb-3 font-semibold">Extraction options <span className="font-normal text-muted-foreground">(optional)</span></h3>
          <div className="mb-3 flex gap-2 rounded-md border border-primary/20 bg-primary/5 p-3 text-sm text-muted-foreground"><Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><p>A template is optional. AI extraction usage is metered against your AI budget.</p></div>
          <Label htmlFor="aidp-template">Document template</Label>
          {(tplOptionSearch || (templateOptionsQ.data?.total ?? 0) > PAGE_SIZE) ? <div className="relative mb-2"><Search aria-hidden="true" className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input aria-label="Search available templates" className="pl-9" placeholder="Search templates" value={tplOptionSearch} onChange={(e) => { setTplOptionSearch(e.target.value); setTplOptionPage(0); }} /></div> : null}
          <Select value={tplPick || "none"} onValueChange={(v) => {
            if (v === "none") { setTplPick(""); setTplPickLabel(""); return; }
            const chosen = templateOptionsQ.data?.rows?.find((t: any) => t.id === v);
            setTplPick(v); if (chosen) setTplPickLabel(chosen.name);
          }}>
            <SelectTrigger id="aidp-template" className="mt-2"><SelectValue placeholder="Choose a template" /></SelectTrigger>
            <SelectContent><SelectItem value="none">No template</SelectItem>
              {tplPick && !templateOptionsQ.data?.rows?.some((t: any) => t.id === tplPick) ? <SelectItem value={tplPick}>{tplPickLabel || "Selected template"}</SelectItem> : null}
              {(templateOptionsQ.data?.rows ?? []).map((t: any) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {templateOptionsQ.isPending ? <p role="status" className="mt-2 text-xs text-muted-foreground">Loading templates…</p> : templateOptionsQ.isError ? <p role="alert" className="mt-2 text-xs text-destructive">Templates could not be loaded. Retry to check again.</p> : templateOptionsQ.data.total === 0 ? <p role="status" className="mt-2 text-xs text-muted-foreground">{tplOptionSearch ? "No matching templates. Refine the search or choose No template." : "No templates yet. Continue without one or create one below."}</p> : <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground"><span>{templateOptionsQ.data.total > PAGE_SIZE ? `Showing ${tplOptionPage * PAGE_SIZE + 1}–${Math.min((tplOptionPage + 1) * PAGE_SIZE, templateOptionsQ.data.total)} of ${templateOptionsQ.data.total}. Search or use paging to find a template.` : `${templateOptionsQ.data.total} template${templateOptionsQ.data.total === 1 ? "" : "s"} available.`}</span>{templateOptionsQ.data.total > PAGE_SIZE ? <div className="flex shrink-0 gap-1"><Button type="button" size="sm" variant="ghost" className="h-7 px-2" disabled={tplOptionPage === 0} onClick={() => setTplOptionPage((p) => p - 1)}>Previous</Button><Button type="button" size="sm" variant="ghost" className="h-7 px-2" disabled={(tplOptionPage + 1) * PAGE_SIZE >= templateOptionsQ.data.total} onClick={() => setTplOptionPage((p) => p + 1)}>Next</Button></div> : null}</div>}
          {!canWrite ? <p className="mt-2 text-sm text-muted-foreground">You have view access. Ask a tenant administrator for document upload or review permissions.</p> : null}
          <div className="mt-4 flex flex-col items-end gap-2">
            <Button aria-describedby="aidp-upload-guidance" disabled={!canWrite || mUpload.isPending || !selectedFile} onClick={() => { if (selectedFile) mUpload.mutate(selectedFile); }}>
              {mUpload.isPending ? <><RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Processing…</> : <><Upload className="mr-2 h-4 w-4" /> Upload &amp; extract</>}
            </Button>
            <p id="aidp-upload-guidance" role="status" className="text-right text-xs text-muted-foreground">{!canWrite ? "Upload is unavailable with your current access." : mUpload.isPending ? "Your selected document is being processed." : selectedFile ? "Ready to upload. Choosing a template is optional." : "Select a document file to enable upload. Choosing a template is optional."}</p>
          </div>
        </section>
      </CardContent>
    </Card>

    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div><CardTitle className="flex items-center gap-2"><FileText className="h-4 w-4" /> Recent documents</CardTitle><CardDescription>View recent document uploads and extraction status.</CardDescription></div>
        <a href="#aidp-templates" className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline">Manage templates <span aria-hidden="true">→</span></a>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <div className="relative min-w-0"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input aria-label="Search documents" className="pl-9" placeholder="Search by filename" value={docSearch} onChange={(e) => { setDocSearch(e.target.value); setDocPage(0); }} /></div>
          <div><Input type="search" aria-label="Search documents by Public ID" placeholder={canSearchDocPublicId ? "Search Public ID" : "Public ID search unavailable"} value={docPublicIdSearch} disabled={!canSearchDocPublicId} onChange={(e) => { setDocPublicIdSearch(e.target.value); setDocPage(0); }} /></div>
          <Input type="date" aria-label="Created from date (UTC)" value={docCreatedFrom} max={docCreatedTo || undefined} onChange={(e) => { setDocCreatedFrom(e.target.value); setDocPage(0); }} />
          <Input type="date" aria-label="Created through date (UTC)" value={docCreatedTo} min={docCreatedFrom || undefined} onChange={(e) => { setDocCreatedTo(e.target.value); setDocPage(0); }} />
          <Select value={docStatus} onValueChange={(v) => { setDocStatus(v as typeof docStatus); setDocPage(0); }}><SelectTrigger aria-label="Filter documents by status"><SelectValue /></SelectTrigger><SelectContent>{STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s === "all" ? "All statuses" : s.replaceAll("_", " ")}</SelectItem>)}</SelectContent></Select>
        </div>
        {!canSearchDocPublicId ? <p role="status" className="text-xs text-muted-foreground">Public ID search is disabled until authorized resource identity is available for a visible document. Business unit, user group, and actor filters are unavailable pending secure full-collection query support.</p> : <p className="text-xs text-muted-foreground">Business unit, user group, and actor filters are unavailable pending secure full-collection query support.</p>}
        {docDateRangeError ? <p role="alert" className="text-sm text-destructive">Created-through date must be on or after created-from date. Results are paused until the range is corrected.</p> : dQ.isPending ? <StateMessage title="Loading documents" body="Retrieving recent documents for this tenant." /> : dQ.isError ? <StateMessage title="Documents unavailable" body="We could not retrieve documents. Retry to check again." action={<Button className="mt-2" variant="outline" onClick={() => dQ.refetch()}>Retry</Button>} /> : dQ.data.total === 0 ? <StateMessage title="No documents found" body={docSearch || docPublicIdSearch || docCreatedFrom || docCreatedTo || docStatus !== "all" ? "Adjust your search, created-date range, or status filter." : "Upload a document to start a processing and review record."} /> :
          <div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-sm"><thead className="border-b text-left text-xs uppercase text-muted-foreground"><tr><th scope="col">Public ID</th><th scope="col" className="py-2">Document name</th><th scope="col">Business units</th><th scope="col">User groups</th><th scope="col">Uploaded</th><th scope="col">Template</th><th scope="col">Status</th><th scope="col" className="fvi-sticky-view-cell text-right">Actions</th></tr></thead><tbody>{dQ.data.rows.map((d: any) => { const isSelected = viewIdentity?.kind === "document" && viewIdentity.id === d.id; return <tr key={d.id} aria-selected={isSelected} className={`border-b last:border-0 ${isSelected ? "fvi-selected-row" : ""}`}><td><ResourceIdentitySummary section="identity" summary={docAccessById.get(d.id)} available={docAccessQ.data?.available === true} /></td><td className="py-3"><span className="block max-w-[320px] truncate font-medium" title={d.original_filename}>{d.original_filename}</span><span className="text-xs text-muted-foreground">{(Number(d.bytes) / (1024 * 1024)).toFixed(2)} MB</span></td><td><ResourceIdentitySummary section="business-units" summary={docAccessById.get(d.id)} available={docAccessQ.data?.available === true} /></td><td><ResourceIdentitySummary section="user-groups" summary={docAccessById.get(d.id)} available={docAccessQ.data?.available === true} /></td><td className="whitespace-nowrap text-xs text-muted-foreground">{new Date(d.created_at).toLocaleString()}</td><td className="text-muted-foreground">{d.template_id ? templateOptionsQ.data?.rows?.find((t: any) => t.id === d.template_id)?.name ?? "Template applied" : "No template"}</td><td><Badge variant={d.status === "approved" ? "default" : d.status === "failed" ? "destructive" : "outline"}>{d.status}</Badge></td><td className="fvi-sticky-view-cell"><div className="flex justify-end gap-1">
            <Button size="sm" variant="outline" className="fvi-row-view-action" onClick={(event) => { viewTriggerRef.current = event.currentTarget; setViewIdentity({ kind: "document", id: d.id }); }}>View detail</Button>
            {(d.mime === "application/pdf" || /\.pdf$/i.test(d.original_filename)) ? <Button asChild size="sm" variant="outline"><Link to="/$slug/aidp/annotate/$documentId" params={{ slug: tenantSlug, documentId: d.id }}><PencilRuler className="mr-1 h-3 w-3" /> Review</Link></Button> : null}
            <Button size="sm" variant="ghost" onClick={() => setAuditDocId(d.id)} title="View audit timeline"><History className="mr-1 h-3 w-3" /> Audit</Button>
            {canWrite && d.status === "review" ? <Button size="sm" variant="outline" disabled={mApprove.isPending} onClick={() => mApprove.mutate(d.id)}><Check className="mr-1 h-3 w-3" /> Approve</Button> : null}
          </div></td></tr>; })}</tbody></table><PageControls page={docPage} total={dQ.data.total} onPage={setDocPage} /></div>}
      </CardContent>
    </Card>

    <Card id="aidp-templates" className="scroll-mt-4">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div><CardTitle className="flex items-center gap-2"><Layers className="h-4 w-4" /> Manage templates</CardTitle><CardDescription>Reusable document kinds and extraction prompts.</CardDescription></div>
        <Dialog open={tplOpen} onOpenChange={setTplOpen}>
          <DialogTrigger asChild><Button ref={newTemplateButtonRef} size="sm" disabled={!canWrite}><Plus className="mr-1 h-4 w-4" /> New template</Button></DialogTrigger>
          <DialogContent><DialogHeader><DialogTitle>New template</DialogTitle></DialogHeader><div className="space-y-3">
            <div><Label htmlFor="aidp-template-name">Name</Label><Input id="aidp-template-name" value={tpl.name} onChange={(e) => setTpl({ ...tpl, name: e.target.value })} /></div>
            <div><Label>Document kind</Label><Select value={tpl.doc_kind} onValueChange={(v) => setTpl({ ...tpl, doc_kind: v as typeof tpl.doc_kind })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{DOC_KINDS.map((k) => <SelectItem key={k} value={k}>{k.replaceAll("_", " ")}</SelectItem>)}</SelectContent></Select></div>
            <div><Label htmlFor="aidp-template-prompt">Extraction prompt</Label><Textarea id="aidp-template-prompt" rows={5} value={tpl.sample_prompt} onChange={(e) => setTpl({ ...tpl, sample_prompt: e.target.value })} /></div>
            <Button className="w-full" disabled={!tpl.name.trim() || mTpl.isPending} onClick={() => mTpl.mutate()}>{mTpl.isPending ? "Saving…" : "Save template"}</Button>
          </div></DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <div className="relative min-w-0"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input aria-label="Search templates" className="pl-9" placeholder="Search templates" value={tplSearch} onChange={(e) => { setTplSearch(e.target.value); setTplPage(0); }} /></div>
          <Input type="search" aria-label="Search templates by Public ID" placeholder={canSearchTemplatePublicId ? "Search Public ID" : "Public ID search unavailable"} value={tplPublicIdSearch} disabled={!canSearchTemplatePublicId} onChange={(e) => { setTplPublicIdSearch(e.target.value); setTplPage(0); }} />
          <Input type="date" aria-label="Templates created from date (UTC)" value={tplCreatedFrom} max={tplCreatedTo || undefined} onChange={(e) => { setTplCreatedFrom(e.target.value); setTplPage(0); }} />
          <Input type="date" aria-label="Templates created through date (UTC)" value={tplCreatedTo} min={tplCreatedFrom || undefined} onChange={(e) => { setTplCreatedTo(e.target.value); setTplPage(0); }} />
          <Select value={tplKind} onValueChange={(v) => { setTplKind(v); setTplPage(0); }}><SelectTrigger aria-label="Filter templates by kind"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All kinds</SelectItem>{DOC_KINDS.map((k) => <SelectItem key={k} value={k}>{k.replaceAll("_", " ")}</SelectItem>)}</SelectContent></Select>
        </div>
        {!canSearchTemplatePublicId ? <p role="status" className="text-xs text-muted-foreground">Public ID search is disabled until authorized resource identity is available for a visible template. Business unit, user group, and actor filters are unavailable pending secure full-collection query support.</p> : <p className="text-xs text-muted-foreground">Business unit, user group, and actor filters are unavailable pending secure full-collection query support.</p>}
        {templateDateRangeError ? <p role="alert" className="text-sm text-destructive">Created-through date must be on or after created-from date. Results are paused until the range is corrected.</p> : tQ.isPending ? <StateMessage title="Loading templates" body="Retrieving templates for this tenant." /> : tQ.isError ? <StateMessage title="Templates unavailable" body="We could not retrieve templates. Retry to check again." action={<Button className="mt-2" variant="outline" onClick={() => tQ.refetch()}>Retry</Button>} /> : tQ.data.total === 0 ? <StateMessage title="No templates found" body={tplSearch || tplPublicIdSearch || tplCreatedFrom || tplCreatedTo || tplKind !== "all" ? "Adjust the search, created-date range, or kind filter." : "Create a template to define reusable document extraction settings."} /> :
          <div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-sm"><thead className="border-b text-left text-xs uppercase text-muted-foreground"><tr><th>Public ID</th><th className="py-2">Name</th><th>Business units</th><th>User groups</th><th>Kind</th><th>Created</th><th className="fvi-sticky-view-cell text-right">Actions</th></tr></thead><tbody>{templates.map((t: any) => { const isSelected = viewIdentity?.kind === "template" && viewIdentity.id === t.id; return <tr key={t.id} aria-selected={isSelected} className={`border-b ${isSelected ? "fvi-selected-row" : ""}`}><td><ResourceIdentitySummary section="identity" summary={templateAccessById.get(t.id)} available={templateAccessQ.data?.available === true} /></td><td className="py-3 font-medium">{t.name}</td><td><ResourceIdentitySummary section="business-units" summary={templateAccessById.get(t.id)} available={templateAccessQ.data?.available === true} /></td><td><ResourceIdentitySummary section="user-groups" summary={templateAccessById.get(t.id)} available={templateAccessQ.data?.available === true} /></td><td><Badge variant="outline">{t.doc_kind.replaceAll("_", " ")}</Badge></td><td className="text-muted-foreground">{new Date(t.created_at).toLocaleDateString()}</td><td className="fvi-sticky-view-cell text-right"><Button size="sm" variant="outline" className="fvi-row-view-action" onClick={(event) => { viewTriggerRef.current = event.currentTarget; setViewIdentity({ kind: "template", id: t.id }); }}>View detail</Button>{canWrite ? <Button size="icon" variant="ghost" aria-label={`Delete ${t.name}`} disabled={mDel.isPending} onClick={() => mDel.mutate(t.id)}><Trash2 className="h-4 w-4" /></Button> : null}</td></tr>; })}</tbody></table><PageControls page={tplPage} total={tQ.data.total} onPage={setTplPage} /></div>}
      </CardContent>
    </Card>

    <ExtractionAuditTimeline tenantId={tenantId} documentId={auditDocId} open={!!auditDocId} onOpenChange={(o) => { if (!o) setAuditDocId(null); }} />
    <Dialog open={!!viewIdentity} onOpenChange={(open) => { if (!open) setViewIdentity(null); }}>
      <DialogContent className="h-[min(92dvh,64rem)] max-h-[92dvh] w-[calc(100vw-1rem)] max-w-[min(96vw,88rem)] overflow-hidden gap-0 p-0" onOpenAutoFocus={(event) => { event.preventDefault(); (event.currentTarget as HTMLElement).querySelector<HTMLElement>("[data-fvi-dialog-title]")?.focus(); }} onCloseAutoFocus={(event) => { event.preventDefault(); if (viewTransitionRef.current) { viewTransitionRef.current = false; return; } if (viewTriggerRef.current?.isConnected) viewTriggerRef.current.focus(); else newTemplateButtonRef.current?.focus(); }}>
        {viewedDoc ? <FviDetailDialogLayout
          railEyebrow="DOCUMENT PROCESSING" railTitle="DOCUMENT"
          railStatus={<Badge variant={viewedDoc.status === "approved" ? "default" : viewedDoc.status === "failed" ? "destructive" : "outline"}>{viewedDoc.status}</Badge>}
          railFields={[
            { label: "Document name", value: viewedDoc.original_filename },
            { label: "Uploaded", value: new Date(viewedDoc.created_at).toLocaleString() },
            { label: "File size", value: `${(Number(viewedDoc.bytes) / (1024 * 1024)).toFixed(2)} MB` },
            { label: "Template", value: viewedDoc.template_id ? templateOptionsQ.data?.rows?.find((t: any) => t.id === viewedDoc.template_id)?.name ?? "Template applied" : "No template" },
          ]}
          title={viewedDoc.original_filename} description="Document identity, recorded extraction state, and available review actions."
          content={<div className="space-y-5"><ResourceIdentitySummary mode="detail" summary={docAccessById.get(viewedDoc.id)} available={docAccessQ.data?.available === true} />{docActorsQ.isPending ? <p role="status" className="text-xs text-muted-foreground">Loading actor attribution…</p> : <ResourceActorSummary mode="detail" summary={docActorsById.get(viewedDoc.id)} available={docActorsQ.data?.available === true} />}<dl className="grid gap-4 border-t pt-5 text-sm sm:grid-cols-2"><div><dt className="text-xs text-muted-foreground">Processing status</dt><dd className="mt-1">{viewedDoc.status}</dd></div><div><dt className="text-xs text-muted-foreground">File type</dt><dd className="mt-1">{viewedDoc.mime}</dd></div><div><dt className="text-xs text-muted-foreground">Recorded confidence</dt><dd className="mt-1">{viewedDoc.confidence == null ? "Not recorded" : `${(Number(viewedDoc.confidence) * 100).toFixed(0)}%`}</dd></div><div><dt className="text-xs text-muted-foreground">Recorded processing cost</dt><dd className="mt-1">{viewedDoc.cost_usd == null ? "Not recorded" : `$ ${Number(viewedDoc.cost_usd).toFixed(4)}`}</dd></div></dl></div>}
          actions={<>
            {(viewedDoc.mime === "application/pdf" || /\.pdf$/i.test(viewedDoc.original_filename)) ? <Button asChild variant="outline"><Link to="/$slug/aidp/annotate/$documentId" params={{ slug: tenantSlug, documentId: viewedDoc.id }}>Review PDF</Link></Button> : null}
            <Button variant="outline" onClick={() => { viewTransitionRef.current = true; setAuditDocId(viewedDoc.id); setViewIdentity(null); }}>Audit timeline</Button>
            {canWrite && viewedDoc.status === "review" ? <Button disabled={mApprove.isPending} onClick={() => mApprove.mutate(viewedDoc.id)}><Check className="mr-2 h-4 w-4" />Approve</Button> : null}
          </>}
        /> : viewedTemplate ? <FviDetailDialogLayout
          railEyebrow="DOCUMENT PROCESSING" railTitle="TEMPLATE" railStatus={<Badge variant="outline">{viewedTemplate.doc_kind.replaceAll("_", " ")}</Badge>}
          railFields={[{ label: "Document kind", value: viewedTemplate.doc_kind.replaceAll("_", " ") }, { label: "Created", value: new Date(viewedTemplate.created_at).toLocaleString() }]}
          title={viewedTemplate.name} description="Template identity, document kind, and access assignments."
          content={<div className="space-y-5"><ResourceIdentitySummary mode="detail" summary={templateAccessById.get(viewedTemplate.id)} available={templateAccessQ.data?.available === true} />{templateActorsQ.isPending ? <p role="status" className="text-xs text-muted-foreground">Loading actor attribution…</p> : <ResourceActorSummary mode="detail" summary={templateActorsById.get(viewedTemplate.id)} available={templateActorsQ.data?.available === true} />}<dl className="grid gap-4 border-t pt-5 text-sm"><div><dt className="text-xs text-muted-foreground">Document kind</dt><dd className="mt-1">{viewedTemplate.doc_kind.replaceAll("_", " ")}</dd></div><div><dt className="text-xs text-muted-foreground">Extraction prompt</dt><dd className="mt-1 whitespace-pre-wrap">{viewedTemplate.sample_prompt || "No extraction prompt provided."}</dd></div></dl></div>}
          actions={canWrite ? <Button variant="destructive" disabled={mDel.isPending} onClick={() => mDel.mutate(viewedTemplate.id)}><Trash2 className="mr-2 h-4 w-4" />Delete template</Button> : null}
        /> : <FviDetailDialogLayout railEyebrow="DOCUMENT PROCESSING" railTitle="RESOURCE" railStatus={<Badge variant="outline">Unavailable</Badge>} railFields={[]} title="Resource detail unavailable" description="This item is no longer on the current page." content={<p className="text-sm text-muted-foreground">Close this view and locate the item again.</p>} actions={null} />}
      </DialogContent>
    </Dialog>
  </div>;
}
