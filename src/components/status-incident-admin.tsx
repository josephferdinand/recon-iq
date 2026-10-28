import { useState, type ChangeEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { INCIDENT_PHASES, incidentDraftSchema } from "@/lib/status.model";
import { getStatusAdminSnapshot, executeStatusIncidentCommand, getStatusIncidentAudit, getStatusIncidentCommandReceipt } from "@/lib/status.workflow.functions";
import { statusRefusalMessage } from "@/lib/status-command-result";
import { incidentFunctionOptions } from "@/lib/status-incident-scope";
import { triageStatusIncidentReport } from "@/lib/status-report.functions";
import { statusUtcInput, statusUtcValue } from "@/lib/status-date-utils";

type Action = "save_draft" | "submit" | "review" | "return" | "publish" | "append_update" | "append_correction";
type Draft = {
  kind: "incident" | "maintenance"; severity: "minor" | "major" | "critical"; status: (typeof INCIDENT_PHASES)[number];
  title: string; summary: string; impact: string; cell_keys: string[]; component_keys: string[]; function_keys: string[];
  started_at: string; detected_at: string; resolved_at: string; occurred_at: string; planned_end_at: string; display_timezone: string;
  correction_reason: string; root_cause: string; remediation: string; evidence_ref: string; public_safe: boolean;
};
const blank = (): Draft => ({ kind: "incident", severity: "minor", status: "investigating", title: "", summary: "", impact: "",
  cell_keys: [], component_keys: [], function_keys: [], started_at: "", detected_at: "", resolved_at: "", occurred_at: "", planned_end_at: "",
  display_timezone: "UTC", correction_reason: "", root_cause: "", remediation: "", evidence_ref: "", public_safe: false });
const local = statusUtcInput;

export function StatusIncidentAdmin({ canWrite }: { canWrite: boolean }) {
  const list = useServerFn(getStatusAdminSnapshot), command = useServerFn(executeStatusIncidentCommand), audit = useServerFn(getStatusIncidentAudit), triage = useServerFn(triageStatusIncidentReport);
  const commandReceipt = useServerFn(getStatusIncidentCommandReceipt);
  const [offset,setOffset]=useState(0), [auditOffset,setAuditOffset]=useState(0);
  const client = useQueryClient(); const query = useQuery({ queryKey: ["status-governed-admin",offset], queryFn: () => list({data:{offset}}), staleTime: 15_000 });
  const [draft, setDraft] = useState<Draft>(blank); const [selection, setSelection] = useState<any>(null);
  const [draftAction, setDraftAction] = useState<"save_draft" | "append_update" | "append_correction">("save_draft");
  const [reason, setReason] = useState(""); const [message, setMessage] = useState("");
  const [auditId, setAuditId] = useState<string | null>(null);
  const [pendingCommand, setPendingCommand] = useState<any>(null);
  const log = useQuery({ queryKey: ["status-incident-audit", auditId,auditOffset], enabled: !!auditId, queryFn: () => audit({ data: { incident_id: auditId!,offset:auditOffset } }) });
  const reviewReport=useMutation({mutationFn:(value:any)=>triage({data:value}),onSuccess:async()=>{setMessage("Report triage recorded. Public publication still requires the independent incident workflow.");await client.invalidateQueries({queryKey:["status-governed-admin"]});},onError:(error)=>setMessage(error.message)});
  async function recorded(receipt: { workflow_state: string; revision: number; request_id: string }) {
    setPendingCommand(null); setMessage(`Recorded ${receipt.workflow_state}, revision ${receipt.revision}. Request ${receipt.request_id}.`);
    setSelection(null); setDraft(blank());
    await client.invalidateQueries({ queryKey: ["status-governed-admin"] });
    await client.invalidateQueries({ queryKey: ["public-status-snapshot"] });
    await client.invalidateQueries({ queryKey: ["status-incident-audit"] });
  }
  const write = useMutation({ mutationFn: (value: any) => command({ data: value }), onSuccess: async (result) => {
    if ("outcome" in result && result.outcome === "refused") {
      setPendingCommand(null); setMessage(`${statusRefusalMessage(result.code)} Private denial audit ${result.denial_id} recorded.`);
      await client.invalidateQueries({ queryKey: ["status-governed-admin"] });
      return;
    }
    if ("id" in result) await recorded(result);
  }, onError: (error) => setMessage(error.message) });
  const checkReceipt = useMutation({ mutationFn: (value: any) => commandReceipt({ data: value }), onSuccess: async (result) => {
    if (result.state === "recorded") await recorded(result.receipt);
    else setMessage("No committed receipt was found. This does not prove refusal: an earlier action may still be running. Keep the exact saved command and request key.");
  }, onError: (error) => setMessage(error.message) });
  function send(action: Action, row = selection) {
    if (pendingCommand) { setMessage("An earlier command is unconfirmed. Refresh the queue or retry that exact command using its saved key."); return; }
    try {
      let payload: unknown = { reason };
      if (["save_draft", "append_update", "append_correction"].includes(action)) {
        const original = selection?.status_incident_versions.find((entry:any)=>entry.revision===selection.current_revision)?.public_payload;
        payload = incidentDraftSchema.parse({ ...draft, started_at: statusUtcValue(draft.started_at,original?.started_at), detected_at: statusUtcValue(draft.detected_at,original?.detected_at),
          resolved_at: statusUtcValue(draft.resolved_at,original?.resolved_at), occurred_at: statusUtcValue(draft.occurred_at,original?.occurred_at), impact: draft.impact || null,
          planned_end_at: statusUtcValue(draft.planned_end_at,original?.planned_end_at),
          correction_reason: draft.correction_reason || null, root_cause: draft.root_cause || null, remediation: draft.remediation || null });
      }
      const value = { request_id: crypto.randomUUID(), incident_id: row?.id ?? null, expected_revision: row?.current_revision ?? 0, action, payload };
      setPendingCommand(value); write.mutate(value);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Check incident fields before saving."); }
  }
  function select(row: any, action: "save_draft" | "append_update" | "append_correction") {
    const version = row.status_incident_versions.find((entry: any) => entry.revision === row.current_revision);
    const payload = version?.public_payload ?? {};
    setSelection(row); setDraftAction(action); setDraft({ ...blank(), ...payload, impact: payload.impact ?? "",
      started_at: local(payload.started_at), detected_at: local(payload.detected_at), resolved_at: local(payload.resolved_at),
      occurred_at: local(payload.occurred_at), evidence_ref: version?.evidence_ref ?? "", public_safe: false,
      planned_end_at: local(payload.planned_end_at),
      correction_reason: "", root_cause: payload.root_cause ?? "", remediation: payload.remediation ?? "" });
    setMessage("");
  }
  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const multi = (event: ChangeEvent<HTMLSelectElement>) => [...event.target.selectedOptions].map((option) => option.value);
  return <Card><CardHeader><CardTitle>Governed incidents and historical updates</CardTitle><CardDescription>Save draft, submit, independent review, then publish. Updates and corrections append records; actual event times remain separate from entry and publication times.</CardDescription></CardHeader><CardContent className="space-y-6">
    {query.isPending && <p role="status">Loading current incident permissions and records…</p>}
    {query.isError && <div role="alert"><p>{query.error.message}</p><Button variant="outline" onClick={() => void query.refetch()}>Retry incident management</Button></div>}
    {query.data && <>
      <div><h3 className="font-semibold">Private tenant/workspace report intake</h3>{query.data.reports.length===0?<p className="text-sm text-muted-foreground">No private reports on this page.</p>:query.data.reports.map((report:any)=>{const events=report.status_report_triage_events??[];const latest=events.reduce((last:any,event:any)=>!last||Number(event.id)>Number(last.id)?event:last,null);return <div key={report.id} className="mt-3 rounded border p-3"><p className="whitespace-pre-wrap text-sm">{report.summary}</p><p className="text-sm text-muted-foreground">Private report {report.id}. Tenant {report.tenant_id}. Reporter {report.requester_id}. Entered {report.entered_at}. Last decision: {latest?.action??"Pending"}.</p><div className="mt-2 flex flex-wrap gap-2"><Button variant="outline" onClick={()=>{setSelection(null);setDraftAction("save_draft");setDraft({...blank(),title:"Reported service incident",summary:report.summary,cell_keys:report.cell_keys,component_keys:report.component_keys,evidence_ref:`Private report ${report.id}`});}}>Prepare incident draft</Button><Button variant="outline" disabled={!selection||reason.length<8||reviewReport.isPending} onClick={()=>reviewReport.mutate({report_id:report.id,expected_event_id:latest?.id??null,action:"linked",incident_id:selection?.id??null,reason})}>Link selected incident</Button><Button variant="outline" disabled={reason.length<8||reviewReport.isPending} onClick={()=>reviewReport.mutate({report_id:report.id,expected_event_id:latest?.id??null,action:"declined",incident_id:null,reason})}>Record declined triage</Button></div></div>;})}</div>
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); send(draftAction); }}>
        <h3 className="font-semibold">{selection ? `${draftAction.replaceAll("_", " ")} · revision ${selection.current_revision}` : "Add incident or historical incident"}</h3>
        <div className="grid gap-4 md:grid-cols-3"><label className="space-y-1 text-sm">Record type<select className="block w-full rounded border bg-background p-2" value={draft.kind} onChange={(event) => setDraft((current) => ({ ...current, kind: event.target.value as Draft["kind"], status: event.target.value === "incident" ? "investigating" : "scheduled" }))}><option value="incident">Incident</option><option value="maintenance">Planned maintenance</option></select></label>
          <label className="space-y-1 text-sm">Severity<select className="block w-full rounded border bg-background p-2" value={draft.severity} onChange={(event) => update("severity", event.target.value as Draft["severity"])}>{["minor", "major", "critical"].map((value) => <option key={value}>{value}</option>)}</select></label>
          <label className="space-y-1 text-sm">Update phase<select className="block w-full rounded border bg-background p-2" value={draft.status} onChange={(event) => update("status", event.target.value as Draft["status"])}>{INCIDENT_PHASES.filter((phase) => draft.kind === "maintenance" ? ["scheduled", "in_progress", "completed"].includes(phase) : !["scheduled", "in_progress", "completed"].includes(phase)).map((value) => <option key={value}>{value}</option>)}</select></label></div>
        <label className="block space-y-1 text-sm">Public title<Input required maxLength={160} value={draft.title} onChange={(event) => update("title", event.target.value)} /></label>
        <label className="block space-y-1 text-sm">Public summary<Textarea required maxLength={2000} value={draft.summary} onChange={(event) => update("summary", event.target.value)} /></label>
        <label className="block space-y-1 text-sm">Public impact<Textarea maxLength={1200} value={draft.impact} onChange={(event) => update("impact", event.target.value)} /></label>
        <div className="grid gap-4 md:grid-cols-2"><label className="space-y-1 text-sm">Affected registered environments / regions<select required multiple size={4} className="block w-full rounded border bg-background p-2" value={draft.cell_keys} onChange={(event) => update("cell_keys", multi(event))}>{query.data.cells.map((cell: any) => <option key={cell.cell_key} value={cell.cell_key} disabled={!cell.enabled}>{cell.display_name} / {cell.region_label ?? "Region unverified"}{cell.enabled ? "" : " (disabled)"}</option>)}</select></label>
          <label className="space-y-1 text-sm">Affected services<select required multiple size={4} className="block w-full rounded border bg-background p-2" value={draft.component_keys} onChange={(event) => update("component_keys", multi(event))}>{query.data.components.map((component: any) => <option key={component.key} value={component.key}>{component.name}</option>)}</select></label></div>
        <label className="block space-y-1 text-sm">Affected registered functions (optional)<select aria-label="Affected registered functions (optional)" multiple size={4} className="block w-full rounded border bg-background p-2" value={draft.function_keys} onChange={(event) => update("function_keys", multi(event))}>{incidentFunctionOptions(query.data.functions ?? [], draft.cell_keys, draft.component_keys, draft.function_keys).map((option) => <option key={option.key} value={option.key} disabled={!option.available}>{option.label}</option>)}</select></label>
        <p className="text-sm text-muted-foreground">Function choices must be registered in every selected environment and associated with a selected service. A registration does not prove measured functional health. Existing historical selections remain visible if their scope changes.</p>
        <div className="grid gap-4 md:grid-cols-2">{([['started_at',draft.status==='scheduled'?'Planned start (UTC)':'Actual start (UTC)'],['detected_at','Actual detection (UTC)'],['resolved_at','Actual resolution (UTC)'],['occurred_at','Announcement/update event time (UTC)']] as const).map(([key, title]) => <label key={key} className="space-y-1 text-sm">{title}<Input type="datetime-local" step="0.001" required={key === "started_at" || key === "occurred_at"} value={draft[key]} onChange={(event) => update(key, event.target.value)} /></label>)}</div>
        {draft.kind==='maintenance'&&<label className="block text-sm">Planned end (UTC)<Input type="datetime-local" step="0.001" value={draft.planned_end_at} onChange={(event)=>update("planned_end_at",event.target.value)}/></label>}
        <p className="text-sm text-muted-foreground">These fields are UTC. Entry and publication timestamps are assigned by the server. Historical entries keep their actual earlier event dates.</p>
        <label className="block space-y-1 text-sm">Public display time zone<Input value={draft.display_timezone} onChange={(event) => update("display_timezone", event.target.value)} placeholder="UTC or Asia/Kolkata" /></label>
        <div className="grid gap-4 md:grid-cols-2"><label className="space-y-1 text-sm">Verified root cause<Textarea maxLength={2000} value={draft.root_cause} onChange={(event) => update("root_cause", event.target.value)} /></label><label className="space-y-1 text-sm">Verified remediation<Textarea maxLength={2000} value={draft.remediation} onChange={(event) => update("remediation", event.target.value)} /></label></div>
        <label className="block space-y-1 text-sm">Private factual evidence reference<Input required maxLength={500} value={draft.evidence_ref} onChange={(event) => update("evidence_ref", event.target.value)} /></label>
        {draftAction === "append_correction" && <label className="block space-y-1 text-sm">Public correction reason<Textarea required minLength={8} maxLength={800} value={draft.correction_reason} onChange={(event) => update("correction_reason", event.target.value)} /></label>}
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" required checked={draft.public_safe} onChange={(event) => update("public_safe", event.target.checked)} />I verified the factual evidence and public summary. It contains no customer details, personal data, credentials or raw diagnostics.</label>
        <div className="flex gap-2"><Button disabled={!canWrite || write.isPending || !!pendingCommand}>Save {draftAction === "save_draft" ? "draft" : draftAction === "append_correction" ? "correction draft" : "update draft"}</Button><Button type="button" variant="outline" onClick={() => { setSelection(null); setDraft(blank()); setDraftAction("save_draft"); }}>New draft</Button></div>
      </form>
      <div><h3 className="font-semibold">Incident review queue</h3><label className="mt-3 block space-y-1 text-sm">Reason for submit, review or publish<Input minLength={8} maxLength={800} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        {query.data.incidents.length === 0 && <p className="mt-3 text-sm text-muted-foreground">No incident drafts or published records have been entered.</p>}
        {query.data.incidents.map((row: any) => { const current = row.status_incident_versions.find((version: any) => version.revision === row.current_revision); const maker = row.maker_id === query.data.actor_id;
          return <div key={row.id} className="mt-3 rounded border p-4"><h4 className="font-semibold">{current?.public_payload.title ?? "Incident"}</h4><p className="text-sm">{row.workflow_state} · revision {row.current_revision} · published revision {row.published_revision ?? "None"}</p><p className="text-sm text-muted-foreground">Entered {row.entered_at}. Current maker: {row.maker_id}. Reviewer: {row.reviewer_id ?? "Not reviewed"}.</p>
            <details className="mt-3 text-sm"><summary className="cursor-pointer font-medium">Review exact revision content and prior versions</summary>{row.status_incident_versions.map((version: any) => <div key={version.revision} className="mt-2 rounded border p-3"><strong>Revision {version.revision}</strong><p className="whitespace-pre-wrap">{version.public_payload.summary}</p><p>Impact: {version.public_payload.impact ?? "None recorded"}</p><p>Phase: {version.public_payload.status}. Start: {version.public_payload.started_at}. Detection: {version.public_payload.detected_at ?? "Not recorded"}. Resolution: {version.public_payload.resolved_at ?? "Not recorded"}.</p><p>Affected scopes: {version.public_payload.cell_keys.join(", ")}. Services: {version.public_payload.component_keys.join(", ")}.</p><p>Root cause: {version.public_payload.root_cause ?? "Not recorded"}. Remediation: {version.public_payload.remediation ?? "Not recorded"}.</p><p>Correction: {version.public_payload.correction_reason ?? "None"}. Private evidence: {version.evidence_ref}.</p><p>Entered {version.entered_at}; actor {version.actor_id}.</p></div>)}</details><div className="mt-3 flex flex-wrap gap-2">
            {["draft", "returned"].includes(row.workflow_state) && maker && <><Button variant="outline" onClick={() => select(row, "save_draft")}>Edit draft</Button><Button disabled={reason.length < 8 || write.isPending || !!pendingCommand} onClick={() => send("submit", row)}>Submit for review</Button></>}
            {row.workflow_state === "submitted" && !maker && <><Button disabled={reason.length < 8 || write.isPending || !!pendingCommand} onClick={() => send("review", row)}>Approve reviewed content</Button><Button variant="outline" disabled={reason.length < 8 || write.isPending || !!pendingCommand} onClick={() => send("return", row)}>Return for correction</Button></>}
            {row.workflow_state === "reviewed" && !maker && <Button disabled={reason.length < 8 || write.isPending || !!pendingCommand} onClick={() => send("publish", row)}>Publish reviewed revision</Button>}
            {row.workflow_state === "published" && <><Button variant="outline" onClick={() => select(row, "append_update")}>Append update</Button><Button variant="outline" onClick={() => select(row, "append_correction")}>Append correction</Button></>}
            <Button variant="outline" onClick={() => {setAuditId(row.id);setAuditOffset(0);}}>View preserved audit</Button>
          </div>{maker && ["submitted", "reviewed"].includes(row.workflow_state) && <p className="mt-2 text-sm">A separate current platform administrator must review and publish this revision.</p>}</div>;
        })}<div className="mt-3 flex gap-2"><Button variant="outline" disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-100))}>Previous records</Button><Button variant="outline" disabled={!query.data.has_more} onClick={()=>setOffset(offset+100)}>Next records</Button><span className="text-sm">Records {offset+1}–{offset+query.data.incidents.length}</span></div>
      </div></>}
    {message && <p role="status" className="rounded border p-3 text-sm whitespace-pre-wrap">{message}</p>}
    {pendingCommand && !write.isPending && <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={checkReceipt.isPending} onClick={() => checkReceipt.mutate(pendingCommand)}>Check saved command receipt</Button><Button variant="outline" onClick={() => void query.refetch()}>Refresh queue</Button><Button disabled={checkReceipt.isPending} onClick={() => write.mutate(pendingCommand)}>Retry exact saved command</Button><p className="text-sm">Request key {pendingCommand.request_id}; the payload remains fixed for this retry.</p></div>}
    {auditId && <div className="space-y-2"><h3 className="font-semibold">Preserved incident audit</h3>{log.isPending && <p>Loading audit…</p>}{log.isError && <p role="alert">{log.error.message}</p>}{log.data?.rows.map((row: any) => <p key={row.id} className="text-sm">{row.entered_at} · actor {row.actor_id} · {row.action} · revision {row.revision} · {row.reason}</p>)}{log.data?.denials?.map((row: any) => <p key={`denial-${row.id}`} className="text-sm">{row.entered_at} · refused {row.action} · code {row.refusal_code} · requested revision {row.expected_revision} · actor {row.actor_id} · request {row.request_id} · private denial {row.id}</p>)}<div className="flex gap-2"><Button variant="outline" disabled={auditOffset===0} onClick={()=>setAuditOffset(Math.max(0,auditOffset-100))}>Previous audit entries</Button><Button variant="outline" disabled={!log.data?.has_more} onClick={()=>setAuditOffset(auditOffset+100)}>Next audit entries</Button></div></div>}
  </CardContent></Card>;
}
