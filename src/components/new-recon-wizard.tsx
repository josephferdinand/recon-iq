import { useState, useMemo, useEffect, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  listWizardSourceCatalog, previewWizardSource, suggestMapping,
  nlMapping, saveDefinitionFromWizard, saveApiSource, saveDbConnection,
  testWizardConnection,
} from "@/lib/rekon-wizard.functions";
import { isDateLike, parseCsv } from "@/lib/csv-parse";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Activity, GitMerge, Triangle, FileText, ClipboardPaste,
  Database, Workflow, Upload, Wand2, Sliders, MessageSquareText,
  ChevronRight, ChevronLeft, X, CheckCircle2, Sparkles, Plus, AlertTriangle,
  History, ShieldCheck, Plug, ListTree,
} from "lucide-react";
import { toast } from "sonner";
import { notifyUserError } from "@/lib/user-feedback";
import { cn } from "@/lib/utils";
import { ReconOwnerPicker } from "@/components/recon-owner-picker";
import { RECON_TYPE_LABELS, reconTypeLabel } from "@/lib/recon-labels";
import { formatUserMessage, mapKnownFailure, type UserMessage, type UserMessageCategory } from "@/lib/user-message";


type Mode = "one_sided" | "two_sided" | "three_sided";
type SrcType = "file" | "paste" | "api" | "existing" | "refined" | "database" | "pdf";
type MapMode = "auto" | "manual" | "nl";

interface SideState {
  side_id: string;
  label: string;
  source_type: SrcType;
  ref_id?: string;
  rows: any[];
  columns: string[];
  paste_text?: string;
  file_name?: string;
  sheet_name?: string;
}

const MODE_META: Record<Mode, { title: string; tag: string; desc: string; Icon: any; tone: string }> = {
  one_sided:   { title: RECON_TYPE_LABELS.one_sided,   tag: "QUALITY",  desc: "Reconcile and validate one dataset against completeness, duplicate, threshold and outlier rules", Icon: Activity, tone: "text-sky-600 bg-sky-50 border-sky-200" },
  two_sided:   { title: RECON_TYPE_LABELS.two_sided,   tag: "CLASSIC",  desc: "Match records between two independent sources and investigate the resulting breaks",             Icon: GitMerge, tone: "text-indigo-600 bg-indigo-50 border-indigo-200" },
  three_sided: { title: RECON_TYPE_LABELS.three_sided, tag: "ADVANCED", desc: "Reconcile three independent parties and identify which relationship caused each break",           Icon: Triangle, tone: "text-violet-600 bg-violet-50 border-violet-200" },
};

const SRC_TABS: { id: SrcType; label: string; Icon: any }[] = [
  { id: "file",     label: "UPLOAD FILE",      Icon: FileText },
  { id: "refined",  label: "DATA PREP OUTPUT", Icon: Workflow },
  { id: "existing", label: "EXISTING DATA",    Icon: Database },
  { id: "paste",    label: "PASTE DATA",       Icon: ClipboardPaste },
];

const SIDE_TONE = [
  "border-l-blue-500 bg-blue-50/40 dark:bg-blue-950/20",
  "border-l-emerald-500 bg-emerald-50/40 dark:bg-emerald-950/20",
  "border-l-violet-500 bg-violet-50/40 dark:bg-violet-950/20",
];

function emptySide(id: string, label: string): SideState {
  return { side_id: id, label, source_type: "file", rows: [], columns: [] };
}

function wizardFailure(error: unknown, action: string, isWrite: boolean, nextActions: Array<{ id: string; label: string }> = []): UserMessage {
  const candidate = error && typeof error === "object" ? error as { code?: unknown; status?: unknown } : {};
  const code = typeof candidate.code === "string" ? candidate.code : undefined;
  const status = typeof candidate.status === "number" ? candidate.status : undefined;
  const mapped = mapKnownFailure(code, status);
  const definitelyRejected = ["input", "business", "auth", "session", "mfa"].includes(mapped.category);
  const category: UserMessageCategory = isWrite
    ? definitelyRejected ? mapped.category : "unknown_write_outcome"
    : ["auth", "session", "mfa", "network", "timeout", "dependency"].includes(mapped.category) ? mapped.category : "system";
  return formatUserMessage({
    ...mapped,
    category,
    action,
    code,
    status,
    retryable: !isWrite,
    availableActions: category === "unknown_write_outcome" || !isWrite ? nextActions : [],
  });
}

export function NewReconWizard({
  tenantId, open, onClose, onCreated,
}: {
  tenantId: string;
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [mode, setMode] = useState<Mode | null>(null);

  return (
    <>
      <Dialog open={open && !mode} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              <DialogTitle>New Reconciliation</DialogTitle>
            </div>
            <DialogDescription>Select reconciliation mode</DialogDescription>
          </DialogHeader>
          <div>
            <h3 className="text-xl font-semibold mb-1">Select Reconciliation Mode</h3>
            <p className="text-sm text-muted-foreground mb-4">Choose how you want to process this dataset. You can always change modes later.</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {(Object.keys(MODE_META) as Mode[]).map((m) => {
                const meta = MODE_META[m];
                const Icon = meta.Icon;
                return (
                  <Card key={m} className="h-full cursor-pointer border transition hover:shadow-md" onClick={() => setMode(m)}>
                    <CardContent className="flex h-full flex-col gap-3 p-5">
                      <div className="flex items-start justify-between">
                        <div className={cn("p-2.5 rounded-lg", meta.tone)}><Icon className="h-5 w-5" /></div>
                        <Badge variant="outline" className="text-[10px] font-semibold tracking-wider">{meta.tag}</Badge>
                      </div>
                      <div>
                        <div className="font-semibold">{meta.title}</div>
                        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{meta.desc}</p>
                      </div>
                      <Button variant="outline" className="mt-auto w-full" size="sm">Select <ChevronRight className="ml-1 h-4 w-4" /></Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {mode && (
        <WizardBody
          tenantId={tenantId}
          mode={mode}
          open={!!mode && open}
          onClose={() => { setMode(null); onClose(); }}
          onCreated={(id) => { setMode(null); onCreated(id); }}
        />
      )}
    </>
  );
}

function WizardBody({
  tenantId, mode, open, onClose, onCreated,
}: { tenantId: string; mode: Mode; open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const meta = MODE_META[mode];
  const sideCount = mode === "one_sided" ? 1 : mode === "two_sided" ? 2 : 3;
  const STEPS = mode === "one_sided"
    ? ["Select Source", "Define Rules", "Review Results", "Save & Govern"]
    : ["Upload Sources", "Confirm Mappings", "Review Results", "Save & Govern"];

  const [step, setStep] = useState(0);
  const [sides, setSides] = useState<SideState[]>(
    Array.from({ length: sideCount }, (_, i) => emptySide(`SOURCE_${String.fromCharCode(65 + i)}`, `Source ${String.fromCharCode(65 + i)}`)),
  );
  const [pendingExcel, setPendingExcel] = useState<Record<number, { file: File; sheets: string[]; selected: string }>>({});
  const [mapMode, setMapMode] = useState<MapMode | null>(null);
  const [mappings, setMappings] = useState<Record<string, Record<string, string>>>({});
  const [keys, setKeys] = useState<string[]>([]);
  const [amountField, setAmountField] = useState<string>("");
  const [dateField, setDateField] = useState<string>("");
  const [nlPrompt, setNlPrompt] = useState("");
  const [name, setName] = useState("");
  const [ownerBuIds, setOwnerBuIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [wizardMessage, setWizardMessage] = useState<UserMessage | null>(null);
  const wizardMessageActionRef = useRef<(() => void) | null>(null);

  function showWizardMessage(message: UserMessage, action?: () => void) {
    wizardMessageActionRef.current = action ?? null;
    setWizardMessage(message);
  }

  function wizardMessageView() {
    if (!wizardMessage) return null;
    return (
      <div role="alert" aria-live="assertive" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
        <p className="font-medium">{wizardMessage.title}</p>
        <p className="mt-1">{wizardMessage.humanMessage}</p>
        {Object.entries(wizardMessage.fieldErrors).filter(([field]) => !["Mapping prompt", "Reconciliation name", "Owning business units"].includes(field)).map(([field, copy]) => <p key={field} className="mt-1 text-destructive">{copy}</p>)}
        {wizardMessage.nextActions.map((action) => <Button key={action.id} type="button" size="sm" variant="outline" className="mt-2" onClick={() => wizardMessageActionRef.current?.()}>{action.label}</Button>)}
      </div>
    );
  }

  const cat = useQuery({
    queryKey: ["wizard-catalog", tenantId],
    queryFn: () => listWizardSourceCatalog({ data: { tenant_id: tenantId } }),
    staleTime: 30_000,
  });

  const fnPreview = useServerFn(previewWizardSource);
  const fnSuggest = useServerFn(suggestMapping);
  const fnNl = useServerFn(nlMapping);
  const fnSave = useServerFn(saveDefinitionFromWizard);
  const fnTest = useServerFn(testWizardConnection);

  // ── Change log (audit trail of every wizard edit) ─────────────────────
  const changeLogRef = useRef<Array<{ at: string; actor_step: number; action: string; detail: any }>>([]);
  const pushLog = (action: string, detail: any = {}) => {
    changeLogRef.current.push({ at: new Date().toISOString(), actor_step: step, action, detail });
  };
  useEffect(() => { pushLog("wizard_opened", { mode, sides: sides.length }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // Watch user-driven scalar state and append entries
  const prevRef = useRef({ mapMode, name, amountField, dateField, keys, mappings: JSON.stringify(mappings) });
  useEffect(() => {
    const p = prevRef.current;
    if (p.mapMode !== mapMode && mapMode) pushLog("map_mode_changed", { from: p.mapMode, to: mapMode });
    if (p.name !== name) pushLog("name_changed", { from: p.name, to: name });
    if (p.amountField !== amountField) pushLog("amount_field_changed", { from: p.amountField, to: amountField });
    if (p.dateField !== dateField) pushLog("date_field_changed", { from: p.dateField, to: dateField });
    if (JSON.stringify(p.keys) !== JSON.stringify(keys)) pushLog("keys_changed", { from: p.keys, to: keys });
    const mNow = JSON.stringify(mappings);
    if (p.mappings !== mNow) pushLog("mappings_edited", { count: Object.keys(mappings).length });
    prevRef.current = { mapMode, name, amountField, dateField, keys, mappings: mNow };
  }, [mapMode, name, amountField, dateField, keys, mappings]);

  const allSidesReady = sides.every((s) => s.columns.length > 0);

  const updateSide = (i: number, patch: Partial<SideState>) => {
    setSides((arr) => arr.map((s, idx) => {
      if (idx !== i) return s;
      const next = { ...s, ...patch };
      // log meaningful per-side edits
      if (patch.source_type && patch.source_type !== s.source_type) pushLog("side_source_type_changed", { side: s.side_id, from: s.source_type, to: patch.source_type });
      if (patch.ref_id && patch.ref_id !== s.ref_id) pushLog("side_ref_changed", { side: s.side_id, ref_id: patch.ref_id });
      if (patch.file_name && patch.file_name !== s.file_name) pushLog("side_file_loaded", { side: s.side_id, file: patch.file_name, rows: (patch.rows ?? []).length, cols: (patch.columns ?? []).length });
      if (patch.sheet_name && patch.sheet_name !== s.sheet_name) pushLog("side_excel_sheet_selected", { side: s.side_id, file: patch.file_name, sheet: patch.sheet_name });
      if (patch.label && patch.label !== s.label) pushLog("side_label_changed", { side: s.side_id, from: s.label, to: patch.label });
      return next;
    }));
  };

  const handleFile = async (i: number, file: File, sheetName?: string) => {
    const extension = `.${file.name.split(".").pop()?.toLowerCase() ?? ""}`;
    const supported = [".csv", ".tsv", ".txt", ".xlsx", ".xls", ".json"];
    if (!supported.includes(extension)) {
      showWizardMessage(formatUserMessage({ category: "input", action: "read this source file", fields: [{ field: "File type", issue: "unsupported_value", allowedValues: supported }] }), () => { setStep(0); setWizardMessage(null); });
      return;
    }
    try {
      const { getExcelSheetNames, parseAnyFile } = await import("@/lib/file-parse");
      if (!sheetName) {
        updateSide(i, { source_type: "file", rows: [], columns: [], file_name: undefined, sheet_name: undefined });
        const sheets = await getExcelSheetNames(file);
        if (sheets.length > 1) {
          setPendingExcel((current) => ({ ...current, [i]: { file, sheets, selected: "" } }));
          return;
        }
      }
      const p = await parseAnyFile(file, sheetName);
      updateSide(i, {
        source_type: "file", file_name: file.name, sheet_name: sheetName,
        rows: p.rows, columns: p.columns.map((c) => c.name),
      });
      setWizardMessage(null);
      setPendingExcel((current) => { const next = { ...current }; delete next[i]; return next; });
    } catch (error) {
      showWizardMessage(wizardFailure(error, "read this source file", false, [{ id: "choose-source", label: "Choose another source" }]), () => { setStep(0); setWizardMessage(null); });
    }
  };

  const handlePaste = (i: number, text: string) => {
    updateSide(i, { paste_text: text });
    if (text.trim()) {
      const p = parseCsv(text, 5000);
      updateSide(i, { source_type: "paste", paste_text: text, rows: p.rows, columns: p.columns.map((c) => c.name) });
    }
  };

  const handleSelectRef = async (i: number, type: SrcType, refId: string) => {
    try {
      const res: any = await fnPreview({ data: { tenant_id: tenantId, source_type: type as any, ref_id: refId } });
      updateSide(i, { source_type: type, ref_id: refId, rows: res.rows, columns: res.columns.map((c: any) => c.name) });
      setWizardMessage(null);
    } catch (error) {
      showWizardMessage(wizardFailure(error, "preview this existing source", false, [{ id: "choose-source", label: "Choose another source" }]), () => { setStep(0); setWizardMessage(null); });
    }
  };

  const runAuto = async () => {
    try {
      const res: any = await fnSuggest({ data: {
        tenant_id: tenantId,
        sides: sides.map((s) => ({ side_id: s.side_id, columns: s.columns })),
      } });
      setMappings(res.mappings ?? {});
      setKeys(res.suggested_keys ?? []);
      setAmountField(res.suggested_amount ?? "");
      setDateField(res.suggested_date ?? "");
      setMapMode("auto");
      toast.success("Auto-detected mappings ready — review & adjust");
    } catch (error) {
      showWizardMessage(wizardFailure(error, "suggest source mappings", false, [{ id: "manual-mapping", label: "Use manual mapping" }]), () => { initManual(); setWizardMessage(null); });
    }
  };

  const runNL = async () => {
    const prompt = nlPrompt.trim();
    if (prompt.length < 3 || prompt.length > 2000) {
      const issue = prompt.length > 2000 ? "too_long" : prompt ? "invalid_format" : "required";
      showWizardMessage(formatUserMessage({ category: "input", action: "generate mappings from this description", fields: [{ field: "Mapping prompt", issue, limit: issue === "too_long" ? 2000 : undefined }] }));
      return;
    }
    try {
      const res: any = await fnNl({ data: {
        tenant_id: tenantId, prompt: nlPrompt,
        sides: sides.map((s) => ({ side_id: s.side_id, columns: s.columns })),
      } });
      setMappings(res.mappings ?? {});
      setKeys(res.keys ?? []);
      setAmountField(res.amount ?? "");
      setDateField(res.date ?? "");
      setMapMode("nl");
      setWizardMessage(null);
      toast.success("AI mapping ready — review the diff");
    } catch (error) {
      showWizardMessage(wizardFailure(error, "generate mappings from this description", false, [{ id: "manual-mapping", label: "Use manual mapping" }]), () => { initManual(); setWizardMessage(null); });
    }
  };

  const initManual = () => {
    if (Object.keys(mappings).length === 0) {
      const m: Record<string, Record<string, string>> = {};
      sides[0].columns.forEach((c) => { m[c] = Object.fromEntries(sides.map((s) => [s.side_id, s.side_id === sides[0].side_id ? c : ""])); });
      setMappings(m);
    }
    setMapMode("manual");
  };

  const save = async () => {
    const fields: Array<{ field: string; issue: "required" | "invalid_format" | "too_long" | "too_large"; limit?: number }> = [];
    const cleanName = name.trim();
    if (!cleanName) fields.push({ field: "Reconciliation name", issue: "required" });
    else if (cleanName.length < 2) fields.push({ field: "Reconciliation name", issue: "invalid_format" });
    else if (cleanName.length > 120) fields.push({ field: "Reconciliation name", issue: "too_long", limit: 120 });
    if (ownerBuIds.length === 0) fields.push({ field: "Owning business units", issue: "required" });
    else if (ownerBuIds.length > 100) fields.push({ field: "Owning business units", issue: "too_large", limit: 100 });
    sides.forEach((side) => {
      if (side.columns.length === 0) fields.push({ field: `${side.label} source columns`, issue: "required" });
      else if (side.columns.length > 500) fields.push({ field: `${side.label} source columns`, issue: "too_large", limit: 500 });
      if (side.columns.some((column) => !column.trim() || column.length > 120)) fields.push({ field: `${side.label} column names`, issue: "invalid_format" });
    });
    if (fields.length) {
      showWizardMessage(formatUserMessage({ category: "input", action: "save this reconciliation draft", fields }));
      return;
    }
    if (saving) return;
    setSaving(true);
    try {
      const res: any = await fnSave({ data: {
        tenant_id: tenantId,
        owner_bu_ids: ownerBuIds,
        mode, name: cleanName,
        sides: sides.map((s) => ({
          side_id: s.side_id, label: s.label,
          source_type: s.source_type,
          ref_id: s.ref_id ?? null,
          columns: s.columns,
          rows: s.rows.slice(0, 5000),
        })),
        mappings, keys, amount_field: amountField || null, date_field: dateField || null,
        rules: [],
        wizard_meta: {
          mode, map_mode: mapMode, nl_prompt: nlPrompt || null,
          change_log: changeLogRef.current,
          owner_bu_ids: ownerBuIds,
          excel_sheets: sides.filter((s) => s.sheet_name).map((s) => ({ side_id: s.side_id, filename: s.file_name, sheet: s.sheet_name })),
          change_count: changeLogRef.current.length,
          saved_at: new Date().toISOString(),
        },
      } });
      setWizardMessage(null);
      if (res.audit_warning) toast.warning("Reconciliation saved, but its wizard-detail audit needs review.");
      else toast.success("Reconciliation saved as draft");
      onCreated(res.id);
    } catch (error) {
      showWizardMessage(wizardFailure(error, "save this reconciliation draft", true, [{ id: "check-reconciliation-list", label: "Check reconciliation list before retrying" }]), () => { onCreated(""); });
    }
    finally { setSaving(false); }
  };

  // ── Per-step validation with friendly messages ────────────────────────
  const validation = useMemo(() => {
    if (step === 0) {
      const unset = sides.filter((s) => s.columns.length === 0);
      if (unset.length) {
        return { ok: false, reason: `Connect ${unset.length === 1 ? "1 source" : `${unset.length} sources`} (${unset.map((u) => u.label).join(", ")}) before continuing.` };
      }
      return { ok: true as const };
    }
    if (step === 1) {
      if (!mapMode) return { ok: false, reason: "Pick a mapping mode — Auto-Detect, Manually Configure, or Describe in English." };
      if (Object.keys(mappings).length === 0) return { ok: false, reason: "No mappings yet — run the chosen mode to generate them." };
      if (sideCount > 1 && keys.length === 0) return { ok: false, reason: "Select at least one key column to match on." };
      if (sideCount > 1) {
        const incomplete = Object.entries(mappings).filter(([_, m]) => sides.some((s) => !m[s.side_id]));
        if (keys.some((k) => sides.some((s) => !mappings[k]?.[s.side_id]))) {
          return { ok: false, reason: "Every selected key must be mapped on every side." };
        }
        if (incomplete.length === Object.keys(mappings).length) {
          return { ok: false, reason: "All mapped fields are empty on at least one side. Map at least one full row." };
        }
      }
      return { ok: true as const };
    }
    if (step === 3) {
      if (!name.trim()) return { ok: false, reason: "Give the reconciliation a name to save." };
    }
    return { ok: true as const };
  }, [step, sides, mapMode, mappings, keys, name, sideCount]);

  const canAdvance = validation.ok;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-[1100px] p-0 flex flex-col">
        <SheetHeader className="px-6 py-4 border-b">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Sparkles className="h-5 w-5 text-primary" />
              <div>
                <SheetTitle className="text-base">{meta.title}</SheetTitle>
                <p className="text-xs text-muted-foreground">Upload, map, test, and save — all in one flow</p>
              </div>
            </div>
            <Badge variant="outline" className="text-[10px]">{meta.tag}</Badge>
          </div>
          <Stepper steps={STEPS} current={step} />
        </SheetHeader>

        <div className="px-6 pt-3">{wizardMessageView()}</div>

        <ScrollArea className="flex-1 px-6 py-5">
          {step === 0 && (
            <div className="space-y-4">
              <div className="rounded-md border bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
                Connect {sideCount === 1 ? "your data source" : `${sideCount === 2 ? "two" : "three"} data sources`} to compare. Choose a file, Data Prep output, existing governed source, or bounded pasted snapshot. Configure API, database, SFTP and cloud connections once in the Ingestion Hub, then select their ingested output here.
              </div>
              <div className={cn(
                "grid gap-4",
                sideCount === 1 ? "grid-cols-1" : sideCount === 2 ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1 lg:grid-cols-3",
              )}>
                {sides.map((s, i) => (
                  <SideCard
                    key={s.side_id}
                    index={i}
                    side={s}
                    tenantId={tenantId}
                    catalog={cat.data}
                    onPickType={(t) => {
                      setPendingExcel((current) => { const next = { ...current }; delete next[i]; return next; });
                      updateSide(i, { source_type: t, rows: [], columns: [], ref_id: undefined, file_name: undefined, sheet_name: undefined, paste_text: undefined });
                    }}
                    onFile={(f) => handleFile(i, f)}
                    pendingExcel={pendingExcel[i]}
                    onSelectSheet={(selected) => setPendingExcel((current) => ({ ...current, [i]: { ...current[i], selected } }))}
                    onImportSheet={() => {
                      const pending = pendingExcel[i];
                      if (pending?.selected) void handleFile(i, pending.file, pending.selected);
                    }}
                    onCancelSheet={() => setPendingExcel((current) => { const next = { ...current }; delete next[i]; return next; })}
                    onPaste={(t) => handlePaste(i, t)}
                    onSelectRef={(t, id) => handleSelectRef(i, t, id)}
                    onTestConnection={async () => {
                      if (s.source_type === "file" || s.source_type === "paste") {
                        const ok = s.columns.length > 0;
                        pushLog("test_connection", { side: s.side_id, source_type: s.source_type, ok, sample_rows: s.rows.length });
                        return { ok, status: ok ? 200 : 400, latency_ms: 0,
                          detail: ok ? `Parsed ${s.rows.length} rows · ${s.columns.length} columns` : `No data parsed yet`,
                          columns: s.columns, sample_rows: s.rows.length };
                      }
                      try {
                        const res: any = await fnTest({ data: { tenant_id: tenantId, source_type: s.source_type as any, ref_id: s.ref_id } });
                        const failure = wizardFailure({ code: res.code, status: res.status }, `test the ${s.label} connection`, false);
                        const columns = Array.isArray(res.columns) ? res.columns : [];
                        const sampleRows = Number(res.sample_rows) || 0;
                        const detail = res.ok
                          ? `Connection test succeeded. ${columns.length} columns and ${sampleRows} sample rows are available.`
                          : failure.humanMessage;
                        pushLog("test_connection", { side: s.side_id, source_type: s.source_type, ok: Boolean(res.ok), code: failure.code, status: failure.status });
                        return { ok: Boolean(res.ok), status: failure.status ?? 200, latency_ms: Number(res.latency_ms) || 0, detail, columns, sample_rows: sampleRows };
                      } catch (error) {
                        const failure = wizardFailure(error, `test the ${s.label} connection`, false);
                        pushLog("test_connection", { side: s.side_id, source_type: s.source_type, ok: false, code: failure.code, status: failure.status });
                        return { ok: false, status: failure.status ?? 500, latency_ms: 0, detail: failure.humanMessage, columns: [], sample_rows: 0 };
                      }
                    }}
                  />
                ))}
              </div>

              {/* Mapping mode preview — visible on Upload step so users see the next choices */}
              <div className="pt-2">
                <p className="text-xs text-center text-muted-foreground mb-3">
                  Connect {sideCount === 1 ? "the source" : "both sources"} above, then choose how you want to define {sideCount === 1 ? "rules" : "mappings"}.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <ModeCard active={false} disabled={!allSidesReady} title="Auto-Detect Columns" desc="Deterministic schema heuristics suggest mappings from column names and common financial aliases. Best for getting started fast." Icon={Wand2} onClick={() => { if (allSidesReady) { setStep(1); setTimeout(runAuto, 50); } }} />
                  <ModeCard active={false} disabled={!allSidesReady} title="Manually Configure" desc="Drag-and-drop two-pane editor. Rename columns, set keys, calc cols, ignore noise. Full control." Icon={Sliders} onClick={() => { if (allSidesReady) { setStep(1); setTimeout(initManual, 50); } }} />
                  <ModeCard active={false} disabled={!allSidesReady} title="Describe in English" desc="Type a sentence. ReconIQ AI reasons, plans column mappings, and runs the match for you. Most agentic." Icon={MessageSquareText} onClick={() => { if (allSidesReady) { setStep(1); setMapMode("nl"); } }} />
                </div>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-5">
              <p className="text-sm text-center text-muted-foreground">
                {sideCount === 1 ? "Choose how you want to define reconciliation rules." : "Connect all sources, then choose how you want to define mappings."}
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <ModeCard active={mapMode === "auto"} title="Auto-Detect Columns" desc="Deterministic schema heuristics suggest mappings from column names and common financial aliases. Best for getting started fast." Icon={Wand2} onClick={runAuto} />
                <ModeCard active={mapMode === "manual"} title="Manually Configure" desc="Drag-and-drop two-pane editor. Rename columns, set keys, calc cols, ignore noise. Full control." Icon={Sliders} onClick={initManual} />
                <ModeCard active={mapMode === "nl"} title="Describe in English" desc="Type a sentence. ReconIQ AI reasons, plans column mappings, and runs the match for you. Most agentic." Icon={MessageSquareText} onClick={() => setMapMode("nl")} />
              </div>

              {mapMode === "nl" && (
                <div className="space-y-2">
                  <Label htmlFor="wizard-nl-prompt">Describe the mapping</Label>
                  <Textarea id="wizard-nl-prompt" rows={3} maxLength={2000} value={nlPrompt} aria-invalid={Boolean(wizardMessage?.fieldErrors["Mapping prompt"])} aria-describedby={wizardMessage?.fieldErrors["Mapping prompt"] ? "wizard-nl-prompt-error" : "wizard-nl-prompt-help"} onChange={(e) => { setNlPrompt(e.target.value); setWizardMessage(null); }}
                    placeholder='e.g. "Match Demo Bank trades by trade_id and value_date. Tolerance on amount is 0.01 USD."' />
                  <p id="wizard-nl-prompt-help" className="text-xs text-muted-foreground">Use 3–2,000 characters. AI suggestions are not applied until you review and save the draft.</p>
                  {wizardMessage?.fieldErrors["Mapping prompt"] ? <p id="wizard-nl-prompt-error" role="alert" className="text-xs text-destructive">{wizardMessage.fieldErrors["Mapping prompt"]}</p> : null}
                  <Button onClick={runNL}><Sparkles className="mr-2 h-4 w-4" /> Generate mapping</Button>
                </div>
              )}

              {mapMode && Object.keys(mappings).length > 0 && (
                <MappingTable sides={sides} mappings={mappings} setMappings={setMappings}
                  keys={keys} setKeys={setKeys} amountField={amountField} setAmountField={setAmountField}
                  dateField={dateField} setDateField={setDateField} />
              )}
            </div>
          )}

          {step === 2 && (
            <ReviewStep sides={sides} mappings={mappings} keys={keys} amountField={amountField} dateField={dateField} mode={mode} mapMode={mapMode} />
          )}

          {step === 3 && (
            <div className="space-y-4 max-w-xl">
              <ReconOwnerPicker tenantId={tenantId} value={ownerBuIds} disabled={saving} onChange={(next) => {
                setOwnerBuIds(next);
                setWizardMessage(null);
                pushLog("owner_business_units_changed", { owner_bu_ids: next });
              }} />
              {wizardMessage?.fieldErrors["Owning business units"] ? <p role="alert" className="text-xs text-destructive">{wizardMessage.fieldErrors["Owning business units"]}</p> : null}
              <div>
                <Label htmlFor="wizard-reconciliation-name">Reconciliation name</Label>
                <Input id="wizard-reconciliation-name" value={name} maxLength={120} aria-invalid={Boolean(wizardMessage?.fieldErrors["Reconciliation name"])} aria-describedby={wizardMessage?.fieldErrors["Reconciliation name"] ? "wizard-name-error" : "wizard-name-help"} onChange={(e) => { setName(e.target.value); setWizardMessage(null); }} placeholder="e.g. Daily Custody vs Ledger" />
                <p id="wizard-name-help" className="mt-1 text-xs text-muted-foreground">Use 2–120 characters.</p>
                {wizardMessage?.fieldErrors["Reconciliation name"] ? <p id="wizard-name-error" role="alert" className="mt-1 text-xs text-destructive">{wizardMessage.fieldErrors["Reconciliation name"]}</p> : null}
              </div>
              <div className="rounded-md border p-4 bg-muted/30 text-sm space-y-1">
                <div><b>Mode:</b> {meta.title}</div>
                <div><b>Sides:</b> {sides.map((s) => `${s.side_id} (${s.source_type})`).join(" · ")}</div>
                <div><b>Keys:</b> {keys.join(", ") || "—"}</div>
                <div><b>Amount:</b> {amountField || "—"}</div>
                <div><b>Mapping mode:</b> {mapMode ?? "—"}</div>
              </div>
              <Alert className="border-primary/30 bg-primary/5">
                <History className="h-4 w-4" />
                <AlertTitle className="text-xs font-semibold">Version 1 will be snapshotted</AlertTitle>
                <AlertDescription className="text-xs">
                  Saving creates v1 in the definition's version history and writes an immutable audit-log entry capturing every connector, mapping, and key chosen in this wizard.
                </AlertDescription>
              </Alert>
              <Button onClick={save} size="lg" disabled={saving}><CheckCircle2 className="mr-2 h-4 w-4" /> {saving ? "Saving…" : "Save as draft"}</Button>
            </div>
          )}
        </ScrollArea>

        <div className="border-t px-6 py-3 bg-background space-y-2">
          {!validation.ok && step < STEPS.length - 1 && (
            <div role="alert" aria-live="polite" className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-900">
              <AlertTriangle className="h-3.5 w-3.5" /> {validation.reason}
            </div>
          )}
          <div className="flex items-center justify-between">
            <Button variant="ghost" onClick={onClose}><X className="mr-2 h-4 w-4" /> Cancel</Button>
            <div className="flex items-center gap-2">
              {step > 0 && <Button variant="outline" onClick={() => setStep(step - 1)}><ChevronLeft className="mr-2 h-4 w-4" /> Back</Button>}
              {step < STEPS.length - 1 && (
                <Button onClick={() => setStep(step + 1)} disabled={!canAdvance}>
                  Continue <ChevronRight className="ml-2 h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}


function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div className="flex items-center gap-2 pt-3">
      {steps.map((s, i) => (
        <div key={s} className="flex items-center gap-2 flex-1">
          <div className={cn("h-6 w-6 rounded-full flex items-center justify-center text-xs font-semibold",
            i < current ? "bg-primary text-primary-foreground" : i === current ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
            {i + 1}
          </div>
          <span className={cn("text-xs whitespace-nowrap", i === current ? "font-semibold" : "text-muted-foreground")}>{s}</span>
          {i < steps.length - 1 && <div className="h-px flex-1 bg-border" />}
        </div>
      ))}
    </div>
  );
}

function ModeCard({ active, disabled, title, desc, Icon, onClick }: { active: boolean; disabled?: boolean; title: string; desc: string; Icon: any; onClick: () => void }) {
  return (
    <Card className={cn("h-full transition", disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer", active ? "border-primary ring-2 ring-primary/20" : !disabled && "hover:shadow-md")} onClick={() => { if (!disabled) onClick(); }}>
      <CardContent className="flex h-full flex-col gap-2 p-4">
        <div className="p-2 rounded-md bg-primary/10 w-fit"><Icon className="h-4 w-4 text-primary" /></div>
        <div className="font-semibold text-sm">{title}</div>
        <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
      </CardContent>
    </Card>
  );
}

function SideCard({
  index, side, tenantId, catalog, onPickType, onFile, pendingExcel, onSelectSheet, onImportSheet, onCancelSheet, onPaste, onSelectRef, onTestConnection,
}: {
  index: number; side: SideState; tenantId: string; catalog: any;
  onPickType: (t: SrcType) => void;
  onFile: (f: File) => void;
  pendingExcel?: { file: File; sheets: string[]; selected: string };
  onSelectSheet: (sheet: string) => void;
  onImportSheet: () => void;
  onCancelSheet: () => void;
  onPaste: (t: string) => void;
  onSelectRef: (t: SrcType, id: string) => void;
  onTestConnection: () => Promise<{ ok: boolean; status: number; latency_ms: number; detail: string; columns: string[]; sample_rows: number }>;
}) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; detail: string; latency_ms: number } | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const runTest = async () => {
    setTesting(true);
    try {
      const r = await onTestConnection();
      setTestResult({ ok: r.ok, detail: r.detail, latency_ms: r.latency_ms });
      if (r.ok) toast.success(`${side.label}: connection check succeeded`);
    } finally { setTesting(false); }
  };
  const refList = useMemo(() => {
    if (!catalog) return [];
    switch (side.source_type) {
      case "existing": return (catalog.existing ?? []).map((r: any) => ({ id: r.id, label: r.name }));
      case "refined":  return (catalog.refined ?? []).map((r: any) => ({ id: r.id, label: r.name }));
      case "pdf":      return (catalog.pdf ?? []).map((r: any) => ({ id: r.id, label: r.original_filename }));
      case "api":      return (catalog.api ?? []).map((r: any) => ({ id: r.id, label: r.name }));
      case "database": return (catalog.database ?? []).map((r: any) => ({ id: r.id, label: `${r.name} (${r.dialect})` }));
      default: return [];
    }
  }, [catalog, side.source_type]);

  return (
    <Card aria-label={`${side.label} source`} data-testid={`recon-source-${side.side_id}`}
      className={cn("border-l-4", SIDE_TONE[index] ?? "")}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4" />
          <span className="font-semibold">{side.label}</span>
          {side.columns.length > 0 && (
            <Badge variant="outline" className="text-[10px]">{side.columns.length} cols · {side.rows.length} rows</Badge>
          )}
        </div>
        <div className="grid grid-cols-2 gap-1 rounded-md border bg-muted/30 p-1 sm:grid-cols-4">
          {SRC_TABS.map((t) => {
            const Icon = t.Icon;
            const active = side.source_type === t.id || (t.id === "file" && side.source_type === "pdf");
            return (
              <button key={t.id} type="button" onClick={() => onPickType(t.id)}
                aria-label={`${side.label}: ${t.label}`} aria-pressed={active}
                className={cn("flex flex-col items-center gap-1 py-2 rounded text-[10px] font-semibold tracking-wider transition",
                  active ? "bg-background shadow-sm text-primary" : "text-muted-foreground hover:bg-background/50")}>
                <Icon className="h-4 w-4" />
                {t.label}
              </button>
            );
          })}
        </div>

        {side.source_type === "file" && (
          <div className="space-y-3">
            <label className="block cursor-pointer rounded-lg border-2 border-dashed p-8 text-center transition hover:bg-muted/40">
              <Upload className="mx-auto mb-2 h-6 w-6 text-primary" />
              <div className="text-sm font-medium">{side.file_name ? `${side.file_name}${side.sheet_name ? ` · ${side.sheet_name}` : ""}` : "Drop a supported data file"}</div>
              <div className="mt-1 text-xs text-muted-foreground">or click to browse · CSV, TSV, TXT, Excel and JSON</div>
              <input type="file" aria-label={`${side.label}: upload file`} accept=".csv,.tsv,.txt,.xlsx,.xls,.json" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) onFile(file); e.target.value = ""; }} />
            </label>
            {pendingExcel && (
              <div className="space-y-2 rounded-md border p-3">
                <Label htmlFor={`recon-excel-sheet-${side.side_id}`}>{side.label}: Excel sheet from {pendingExcel.file.name}</Label>
                <select id={`recon-excel-sheet-${side.side_id}`}
                  className="flex h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={pendingExcel.selected} onChange={(e) => onSelectSheet(e.target.value)}>
                  <option value="">Choose a sheet…</option>
                  {pendingExcel.sheets.map((sheet) => <option key={sheet} value={sheet}>{sheet}</option>)}
                </select>
                <div className="flex gap-2">
                  <Button size="sm" disabled={!pendingExcel.selected} onClick={onImportSheet}>Use selected sheet</Button>
                  <Button size="sm" variant="ghost" onClick={onCancelSheet}>Cancel</Button>
                </div>
                <p className="text-xs text-muted-foreground">Only the selected sheet will be used for this source.</p>
              </div>
            )}
            <div className="rounded-md border bg-muted/20 p-3">
              <Label className="text-xs">PDF document</Label>
              <p className="mb-2 text-[11px] text-muted-foreground">PDFs and scans are extracted through AIDP before matching.</p>
              <Select value="" onValueChange={(value) => onSelectRef("pdf", value)}>
                <SelectTrigger aria-label={`${side.label}: select AIDP extraction`}><SelectValue placeholder={(catalog?.pdf ?? []).length ? "Choose an AIDP extraction…" : "No AIDP extraction is ready"} /></SelectTrigger>
                <SelectContent>
                  {(catalog?.pdf ?? []).map((item: { id: string; original_filename: string }) => <SelectItem key={item.id} value={item.id}>{item.original_filename}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
        {side.source_type === "paste" && (
          <div className="space-y-2">
            <Textarea aria-label={`${side.label}: paste CSV or TSV data`} rows={6} placeholder="Paste CSV/TSV here…" value={side.paste_text ?? ""} onChange={(e) => onPaste(e.target.value)} />
            <p className="text-[11px] text-muted-foreground">For small ad-hoc investigations only. ReconIQ stores a timestamped, checksummed snapshot when the reconciliation is saved.</p>
          </div>
        )}
        {["existing", "refined", "pdf"].includes(side.source_type) && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">
                {side.source_type === "refined" ? "Data Prep output" :
                 side.source_type === "pdf" ? "AIDP extraction" : "Existing governed data"}
              </Label>
            </div>
            <Select value={side.ref_id ?? ""} onValueChange={(v) => onSelectRef(side.source_type, v)}>
              <SelectTrigger aria-label={`${side.label}: select ${side.source_type}`}><SelectValue placeholder={refList.length ? `Choose ${side.source_type}…` : "None configured yet"} /></SelectTrigger>
              <SelectContent>
                {refList.map((r: any) => <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
            {side.source_type === "pdf" && refList.length === 0 && (
              <p className="text-xs text-muted-foreground">No extraction is ready. Process the document in <b>Ingestion → AIDP</b>, then return to Upload File.</p>
            )}
            {side.source_type === "refined" && refList.length === 0 && (
              <p className="text-xs text-muted-foreground">Build a pipeline in <b>Data Prep</b> first. Pipelines that have produced a refined dataset will be selectable here.</p>
            )}
            {side.source_type === "existing" && refList.length === 0 && (
              <p className="text-xs text-muted-foreground">Upload a data source in <b>Ingestion → Data Sources</b> first.</p>
            )}
          </div>
        )}

        {/* Test connection + preview rows */}
        <div className="flex items-center justify-between gap-2 pt-1 border-t mt-2">
          <div className="text-[11px] text-muted-foreground flex items-center gap-2">
            {testResult ? (
              <span role={testResult.ok ? "status" : "alert"} aria-live={testResult.ok ? "polite" : "assertive"} className={cn("inline-flex items-center gap-1 font-mono",
                testResult.ok ? "text-emerald-700" : "text-destructive")}>
                {testResult.ok ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                {testResult.detail} {testResult.latency_ms ? `· ${testResult.latency_ms}ms` : ""}
              </span>
            ) : <span className="opacity-60">Not yet tested</span>}
          </div>
          <div className="flex gap-1">
            {side.columns.length > 0 && (
              <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs"
                aria-expanded={showPreview} aria-controls={`recon-source-preview-${side.side_id}`}
                onClick={() => setShowPreview((v) => !v)}>
                <ListTree className="mr-1 h-3 w-3" /> {showPreview ? "Hide" : "Preview"}
              </Button>
            )}
            <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs"
              onClick={runTest} disabled={testing}>
              <Plug className="mr-1 h-3 w-3" /> {testing ? "Testing…" : "Test connection"}
            </Button>
          </div>
        </div>

        {showPreview && side.columns.length > 0 && (
          <div id={`recon-source-preview-${side.side_id}`} className="rounded border bg-muted/20 overflow-hidden">
            <ScrollArea className="max-h-[220px]">
              <table className="w-full text-[11px]">
                <thead className="bg-muted/40 sticky top-0">
                  <tr>{side.columns.slice(0, 12).map((c) => <th key={c} className="text-left px-2 py-1 font-mono">{c}</th>)}</tr>
                </thead>
                <tbody>
                  {side.rows.slice(0, 10).map((row: any, idx: number) => (
                    <tr key={idx} className="border-t">
                      {side.columns.slice(0, 12).map((c) => (
                        <td key={c} className="px-2 py-1 font-mono truncate max-w-[160px]" title={String(row[c] ?? "")}>{String(row[c] ?? "")}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
            <div className="px-2 py-1 text-[10px] text-muted-foreground bg-muted/30 border-t">
              Showing {Math.min(10, side.rows.length)} of {side.rows.length} rows · {Math.min(12, side.columns.length)} of {side.columns.length} columns
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ConfigureNewConnectorDialog({
  kind, tenantId, onSaved,
}: { kind: "api" | "database"; tenantId: string; onSaved: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const saveApi = useServerFn(saveApiSource);
  const saveDb = useServerFn(saveDbConnection);

  // API form
  const [api, setApi] = useState({ name: "", method: "GET" as "GET" | "POST", url: "", jsonpath: "", body: "", auth_secret_ref: "" });
  // DB form
  const [db, setDb] = useState({
    name: "", dialect: "postgres" as "postgres" | "mysql" | "mssql" | "snowflake" | "bigquery",
    host: "", port: 5432, database: "", username: "", secret_ref: "", ssl: true, default_sql: "",
  });

  const apiValid = api.name.trim().length > 0 && /^https?:\/\/.+/i.test(api.url);
  const dbValid = db.name.trim().length > 0 && db.dialect.length > 0;

  const mApi = useMutation({
    mutationFn: () => saveApi({ data: {
      tenant_id: tenantId, name: api.name, method: api.method, url: api.url,
      headers: {}, body: api.body || null, jsonpath: api.jsonpath || null,
      auth_secret_ref: api.auth_secret_ref || null,
    } }),
    onSuccess: (r: any) => { toast.success("API source saved"); setOpen(false); onSaved(r.id); },
    onError: (e: any) => notifyUserError(e, "wizard_api_source_save"),
  });
  const mDb = useMutation({
    mutationFn: () => saveDb({ data: {
      tenant_id: tenantId, name: db.name, dialect: db.dialect,
      host: db.host || null, port: Number(db.port) || null,
      database: db.database || null, username: db.username || null,
      secret_ref: db.secret_ref || null, ssl: db.ssl,
      default_sql: db.default_sql || null,
    } }),
    onSuccess: (r: any) => { toast.success("DB connection saved"); setOpen(false); onSaved(r.id); },
    onError: (e: any) => notifyUserError(e, "wizard_db_source_save"),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs"><Plus className="mr-1 h-3 w-3" /> New</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{kind === "api" ? "New REST API source" : "New database connection"}</DialogTitle>
          <DialogDescription className="text-xs">
            {kind === "api"
              ? "Define an HTTP source. Secrets must be stored in Cloud Secrets and referenced here by name."
              : "Define a database connection. Passwords must live in Cloud Secrets and referenced here by name."}
          </DialogDescription>
        </DialogHeader>
        {kind === "api" ? (
          <div className="space-y-3">
            <div><Label>Name</Label><Input value={api.name} onChange={(e) => setApi({ ...api, name: e.target.value })} /></div>
            <div className="grid grid-cols-[100px_1fr] gap-2">
              <div>
                <Label>Method</Label>
                <Select value={api.method} onValueChange={(v: any) => setApi({ ...api, method: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="GET">GET</SelectItem><SelectItem value="POST">POST</SelectItem></SelectContent>
                </Select>
              </div>
              <div><Label>URL</Label><Input value={api.url} placeholder="https://api.demo-bank.example/v1/nostro-positions" onChange={(e) => setApi({ ...api, url: e.target.value })} />
                {api.url && !/^https?:\/\//i.test(api.url) && <p className="text-xs text-destructive mt-1">URL must start with http(s)://</p>}
              </div>
            </div>
            <div><Label>JSONPath (optional)</Label><Input value={api.jsonpath} placeholder="e.g. $.data.falcon_nostro_lines" onChange={(e) => setApi({ ...api, jsonpath: e.target.value })} /></div>
            <div><Label>Auth secret name (optional)</Label><Input value={api.auth_secret_ref} placeholder="e.g. DEMO_BANK_MT940_API_TOKEN" onChange={(e) => setApi({ ...api, auth_secret_ref: e.target.value })} /></div>
            {api.method === "POST" && <div><Label>Body</Label><Textarea rows={3} value={api.body} onChange={(e) => setApi({ ...api, body: e.target.value })} /></div>}
          </div>
        ) : (
          <div className="space-y-3">
            <div><Label>Name</Label><Input value={db.name} onChange={(e) => setDb({ ...db, name: e.target.value })} /></div>
            <div>
              <Label>Dialect</Label>
              <Select value={db.dialect} onValueChange={(v: any) => setDb({ ...db, dialect: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["postgres", "mysql", "mssql", "snowflake", "bigquery"].map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-[1fr_100px] gap-2">
              <div><Label>Host</Label><Input value={db.host} onChange={(e) => setDb({ ...db, host: e.target.value })} /></div>
              <div><Label>Port</Label><Input type="number" value={db.port} onChange={(e) => setDb({ ...db, port: Number(e.target.value) })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Database</Label><Input value={db.database} onChange={(e) => setDb({ ...db, database: e.target.value })} /></div>
              <div><Label>Username</Label><Input value={db.username} onChange={(e) => setDb({ ...db, username: e.target.value })} /></div>
            </div>
            <div><Label>Password secret name</Label><Input value={db.secret_ref} placeholder="e.g. DEMO_BANK_GL_DB_PASSWORD" onChange={(e) => setDb({ ...db, secret_ref: e.target.value })} /></div>
            <div><Label>Default SQL (optional)</Label><Textarea rows={2} value={db.default_sql} placeholder="e.g. SELECT * FROM falcon_gl.nostro_positions WHERE business_date = current_date AND currency = 'USD'" onChange={(e) => setDb({ ...db, default_sql: e.target.value })} /></div>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          {kind === "api"
            ? <Button onClick={() => mApi.mutate()} disabled={!apiValid || mApi.isPending}>Save API source</Button>
            : <Button onClick={() => mDb.mutate()} disabled={!dbValid || mDb.isPending}>Save DB connection</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


function MappingTable({
  sides, mappings, setMappings, keys, setKeys, amountField, setAmountField, dateField, setDateField,
}: {
  sides: SideState[];
  mappings: Record<string, Record<string, string>>;
  setMappings: (m: Record<string, Record<string, string>>) => void;
  keys: string[]; setKeys: (k: string[]) => void;
  amountField: string; setAmountField: (v: string) => void;
  dateField: string; setDateField: (v: string) => void;
}) {
  const rows = Object.keys(mappings);
  const toggleKey = (k: string) => setKeys(keys.includes(k) ? keys.filter((x) => x !== k) : [...keys, k]);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Amount field</Label>
          <Select value={amountField} onValueChange={setAmountField}>
            <SelectTrigger><SelectValue placeholder="(none)" /></SelectTrigger>
            <SelectContent>{rows.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Date field</Label>
          <Select value={dateField} onValueChange={setDateField}>
            <SelectTrigger><SelectValue placeholder="(none)" /></SelectTrigger>
            <SelectContent>{rows.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      <div className="border rounded-md overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-3 py-2 font-semibold">Key</th>
              <th className="text-left px-3 py-2 font-semibold">Canonical</th>
              {sides.map((s) => <th key={s.side_id} className="text-left px-3 py-2 font-semibold">{s.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((canonical) => (
              <tr key={canonical} className="border-t">
                <td className="px-3 py-2"><input type="checkbox" checked={keys.includes(canonical)} onChange={() => toggleKey(canonical)} /></td>
                <td className="px-3 py-2 font-mono text-xs">{canonical}</td>
                {sides.map((s) => (
                  <td key={s.side_id} className="px-3 py-2">
                    <Select value={mappings[canonical]?.[s.side_id] ?? ""} onValueChange={(v) => setMappings({ ...mappings, [canonical]: { ...mappings[canonical], [s.side_id]: v } })}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— none —</SelectItem>
                        {s.columns.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function detectType(values: any[]): "number" | "date" | "string" | "boolean" {
  const sample = values.filter((v) => v !== null && v !== "" && v !== undefined).slice(0, 25);
  if (sample.length === 0) return "string";
  if (sample.every((v) => typeof v === "boolean" || ["true", "false"].includes(String(v).toLowerCase()))) return "boolean";
  if (sample.every((v) => !Number.isNaN(Number(String(v).replace(/,/g, ""))))) return "number";
  if (sample.every((v) => isDateLike(String(v)))) return "date";
  return "string";
}

function ReviewStep({ sides, mappings, keys, amountField, dateField, mode, mapMode }: any) {
  const rows = Object.keys(mappings);
  const modeLabel = `${reconTypeLabel(mode)} (${mode === "one_sided" ? 1 : mode === "two_sided" ? 2 : 3})`;

  // Per-mapped-row inferred type from first side that has a column mapped
  const typed = rows.map((canonical) => {
    const map = mappings[canonical] ?? {};
    const sourceCol = sides.find((s: any) => map[s.side_id])
      ? sides.find((s: any) => map[s.side_id])
      : null;
    const colName = sourceCol ? map[sourceCol.side_id] : "";
    const values = sourceCol ? (sourceCol.rows ?? []).map((r: any) => r?.[colName]) : [];
    return { canonical, type: detectType(values), per_side: map };
  });

  // Side completeness
  const completeness = sides.map((s: any) => {
    const filled = rows.filter((r) => mappings[r]?.[s.side_id]).length;
    return { side_id: s.side_id, label: s.label, filled, total: rows.length, pct: rows.length ? Math.round((filled / rows.length) * 100) : 0, rowCount: s.rows.length };
  });

  // Warnings
  const warnings: string[] = [];
  if (!amountField) warnings.push("No amount field selected — value-mismatch checks will be skipped.");
  if (!dateField) warnings.push("No date field selected — ageing & SLA timers will use record-load time only.");
  if (sides.length > 1 && keys.length === 0) warnings.push("No keys selected — matching will fall back to row order.");
  completeness.forEach((c: any) => { if (c.pct < 60 && sides.length > 1) warnings.push(`${c.label} has only ${c.pct}% mappings filled — consider re-running Auto-Detect.`); });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-3">
        <Stat label="Detected mode" value={modeLabel} />
        <Stat label="Sources" value={String(sides.length)} />
        <Stat label="Mapped fields" value={String(rows.length)} />
        <Stat label="Keys" value={keys.length ? keys.join(", ") : "—"} />
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="px-4 py-2 border-b flex items-center justify-between">
            <div className="text-sm font-semibold flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" /> Mapping preview</div>
            <Badge variant="outline" className="text-[10px]">Mode used: {mapMode ?? "—"}</Badge>
          </div>
          <div className="overflow-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="px-3 py-2">Canonical field</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Role</th>
                  {sides.map((s: any) => <th key={s.side_id} className="px-3 py-2">{s.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {typed.map((t) => (
                  <tr key={t.canonical} className="border-t">
                    <td className="px-3 py-2 font-mono">{t.canonical}</td>
                    <td className="px-3 py-2"><Badge variant="outline" className="text-[10px]">{t.type}</Badge></td>
                    <td className="px-3 py-2">
                      {keys.includes(t.canonical) ? <Badge className="text-[10px]">key</Badge> :
                       t.canonical === amountField ? <Badge variant="secondary" className="text-[10px]">amount</Badge> :
                       t.canonical === dateField ? <Badge variant="secondary" className="text-[10px]">date</Badge> :
                       <span className="text-muted-foreground">—</span>}
                    </td>
                    {sides.map((s: any) => (
                      <td key={s.side_id} className="px-3 py-2 font-mono text-[11px]">
                        {t.per_side?.[s.side_id] || <span className="text-muted-foreground">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t px-4 py-2 grid grid-cols-3 gap-3 text-[11px]">
            {completeness.map((c: any) => (
              <div key={c.side_id} className="flex items-center justify-between">
                <span className="text-muted-foreground">{c.label}</span>
                <span>
                  {c.filled}/{c.total} mapped · {c.pct}% · {c.rowCount} rows
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {warnings.length > 0 && (
        <Alert className="border-amber-300 bg-amber-50">
          <AlertTriangle className="h-4 w-4 text-amber-700" />
          <AlertTitle className="text-xs font-semibold text-amber-900">Heads up</AlertTitle>
          <AlertDescription className="text-xs text-amber-900">
            <ul className="list-disc pl-4 space-y-1">
              {warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {mode === "three_sided" && (
        <div className="rounded-md border p-3">
          <div className="text-sm font-semibold mb-2">Result categories after matching</div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            {["Full Match (A+B+C)", "Partial A+B", "Partial A+C", "Partial B+C", "Orphan A", "Orphan B", "Orphan C", "Value Mismatch All"].map((c) => (
              <div key={c} className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-primary" /> {c}</div>
            ))}
          </div>
        </div>
      )}
      <p className="text-xs text-muted-foreground">A full dry-run will execute on Save & Govern. You can adjust rules from the recon editor afterwards.</p>
    </div>
  );
}


function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-semibold text-sm mt-1 truncate">{value}</div>
    </div>
  );
}
