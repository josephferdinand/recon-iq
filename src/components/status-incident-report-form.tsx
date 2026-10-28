import { useState, type FormEvent } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getPublicStatusSnapshot } from "@/lib/status.functions";
import { submitStatusIncidentReport } from "@/lib/status-report.functions";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
/** Parent wires this to its current tenant/workspace context; SQL re-checks the
 * calling membership. Reporting does not confer public publishing authority. */
export function StatusIncidentReportForm({ tenantId }: { tenantId: string }) {
 const query = useQuery({ queryKey: ["public-status-snapshot"], queryFn: () => getPublicStatusSnapshot(), staleTime: 30_000 });
 const [summary,setSummary]=useState(""); const [cell,setCell]=useState(""); const [component,setComponent]=useState("");
 const [pending,setPending]=useState<any>(null); const [message,setMessage]=useState("");
 const send=useMutation({mutationFn:(data:any)=>submitStatusIncidentReport({data}),onSuccess:(result)=>{setMessage(`Report ${result.id} entered the private platform status queue. It has not been published.`);setPending(null);},onError:(error)=>setMessage(error.message)});
 function submit(event:FormEvent){event.preventDefault();if(pending){send.mutate(pending);return;}const data={request_id:crypto.randomUUID(),tenant_id:tenantId,summary,cell_keys:[cell],component_keys:[component]};setPending(data);send.mutate(data);}
 return <form onSubmit={submit} className="space-y-3"><h3 className="font-semibold">Report a service incident</h3><p className="text-sm text-muted-foreground">A current tenant member can report an issue for platform review. Avoid credentials and customer data; this report remains private.</p>
  {query.isError&&<p role="alert">Status scope could not be loaded. Refresh shortly.</p>}
  <label className="block text-sm">Registered environment / region<select required aria-label="Reported environment" className="block w-full rounded border bg-background p-2" value={cell} onChange={(e)=>setCell(e.target.value)}><option value="">Choose scope</option>{query.data?.cells.filter(c=>c.enabled).map(c=><option key={c.cell_key} value={c.cell_key}>{c.display_name} / {c.region_label??"Region unverified"}</option>)}</select></label>
  <label className="block text-sm">Affected service<select required aria-label="Reported service" className="block w-full rounded border bg-background p-2" value={component} onChange={(e)=>setComponent(e.target.value)}><option value="">Choose service</option>{query.data?.components.map(c=><option key={c.key} value={c.key}>{c.name}</option>)}</select></label>
  <label className="block text-sm">Private issue summary<Textarea required minLength={8} maxLength={2000} value={summary} onChange={(e)=>setSummary(e.target.value)}/></label>
  <Button disabled={send.isPending||!cell||!component}>{send.isPending?"Sending report…":pending?"Retry exact saved report":"Send for platform review"}</Button>
  {pending&&<p className="text-sm">Saved request key: {pending.request_id}. A retry uses its exact original payload.</p>}{message&&<p role="status">{message}</p>}
 </form>;
}
