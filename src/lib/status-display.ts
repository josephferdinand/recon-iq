import { measuredState, overallState, type StatusCell, type StatusHealth, type StatusState } from "@/lib/status.model";
import type { StatusComponent } from "@/lib/status.functions";

export type StatusDomain = { key: string; label: string; description: string; rows: StatusHealth[] };
const definitions = [
  ["reconciliation","Reconciliation","Execution, results, exceptions and reconciliation templates."],
  ["ingestion","Ingestion & connectors","Source acquisition and connector-driven data movement."],
  ["data_prep","Data Prep","Preparation pipelines and rules for reconciliation inputs."],
  ["copilot","Copilot","Governed suggestions and assistance within current access."],
  ["schedules","Schedules & recovery","Scheduled execution, job progress and recovery."],
  ["reporting","Reporting & collateral","Reports, exports and collateral lifecycle functions."],
  ["authentication","Authentication","Sign-in and MFA. Declared SSO capability is not integration proof."],
  ["workspace","Workspace & governance","Workspace access, directory, approvals and audit trails."],
  ["documents","Document processing","Document extraction, processing and review."],
  ["api","Enterprise APIs","Purpose-scoped API reachability and functional responses."],
  ["notifications","Notifications","Transactional messages and verified-consent incident updates."],
] as const;

function domainKey(row: StatusHealth): string {
  const key=row.function_key;
  if(key.startsWith("reconciliation.")||key.startsWith("templates."))return "reconciliation";
  if(key.startsWith("data.preparation"))return "data_prep";
  if(key.startsWith("data.ingestion")||key.startsWith("connectors."))return "ingestion";
  if(key.startsWith("copilot."))return "copilot";
  if(key.startsWith("scheduling.")||key.startsWith("recovery."))return "schedules";
  if(key.startsWith("reports.")||key.startsWith("reporting.")||key.startsWith("collateral."))return "reporting";
  if(key.startsWith("identity.")||key.startsWith("auth."))return "authentication";
  if(key.startsWith("documents.")||row.component_key==="aidp")return "documents";
  if(key.startsWith("notifications.")||row.component_key==="email")return "notifications";
  if(key.startsWith("api."))return "api";
  return ({auth:"authentication",api:"api",connectors:"ingestion",recon:"reconciliation",reporting:"reporting",workspace:"workspace"} as Record<string,string>)[row.component_key]??"workspace";
}

/** Every current registry row is retained; no deployment or probe is inferred. */
export function statusDomains(health: readonly StatusHealth[]): StatusDomain[] {
  return definitions.flatMap(([key,label,description])=>{
    const rows=health.filter(row=>domainKey(row)===key);
    return rows.length?[{key,label,description,rows}]:[];
  });
}

export function statusCellEvidence(rows: readonly StatusHealth[],cell: StatusCell,complete:boolean,now=Date.now()) {
  const scoped=rows.filter(row=>row.cell_key===cell.cell_key);
  const states=scoped.map(row=>measuredState(row,now));
  const fresh=scoped.filter((_,index)=>!["unknown","stale","not_available"].includes(states[index]));
  const configured=scoped.filter(row=>row.probe_kind==="functional");
  const latest=configured.flatMap(row=>row.checked_at?[row.checked_at]:[]).sort().at(-1)??null;
  const deployed=scoped.filter(row=>row.availability==="deployed").length;
  const declarations=deployed===scoped.length&&scoped.length>0?"Deployed declaration":scoped.length===0?"No function registry entry":"Deployment unverified";
  const state:StatusState=scoped.length>0&&scoped.every(row=>row.availability==="disabled"||row.availability==="source_only")?"not_available":overallState(states,complete);
  return {rows:scoped,state,fresh:fresh.length,configured:configured.length,total:scoped.length,latest,declarations};
}

export function evidenceLabel(row: StatusHealth,now=Date.now()) {
  const state=measuredState(row,now);
  if(row.availability==="source_only")return "Source only";
  if(row.availability==="disabled")return "Disabled";
  if(row.probe_kind==="availability")return "Reachability only";
  if(row.probe_kind!=="functional")return "No functional probe";
  if(state==="stale")return "Stale observation";
  if(state==="unknown")return "Functional result unknown";
  return "Measured functional check";
}

export const statusStateLabels: Record<StatusState,string>={operational:"Operational",degraded_performance:"Degraded",partial_outage:"Partial outage",major_outage:"Outage",maintenance:"Maintenance",unknown:"Unknown",stale:"Stale",not_available:"Not available"};
