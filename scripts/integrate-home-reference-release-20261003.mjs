import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const packet='./LOCAL_USER/AppData/Local/Temp/fvi-codex-docs-release-20260930';
const candidate='./LOCAL_USER/AppData/Local/Temp/fvi-batch4-candidate-20260928';
const audit='./LOCAL_USER/AppData/Local/Temp/fvi-codex-audit-20260930-4746723';
const backup=audit+'/home-reference-parent-integration-20261003';
try{await access(backup+'/receipt.json');throw Error('Existing integration receipt; inspect before replay');}catch(e){if(e.code!=='ENOENT')throw e;}
const sha=x=>createHash('sha256').update(x).digest('hex');
const ready=JSON.parse(await readFile(candidate+'/output/home-team-p1-20261003/READY.json','utf8'));
for(const f of ready.runtime)if(sha(await readFile(candidate+'/'+f.path))!==f.sha256)throw Error('Qualified Home postimage drift: '+f.path);
const edits=[];
async function existing(rel,expected,transform){
 const original=await readFile(packet+'/'+rel);if(sha(original)!==expected)throw Error('Actual bounded source drift: '+rel);
 const old=original.toString('utf8'),newline=old.includes('\r\n')?'\r\n':'\n';
 const next=transform(old.replaceAll('\r\n','\n')).replaceAll('\n',newline);
 if(next===old)throw Error('Expected concrete integration absent: '+rel);
 edits.push({rel,before:original,after:Buffer.from(next),beforeSha256:sha(original),afterSha256:sha(next)});
}
function replaceOnce(s,before,after){if(s.split(before).length!==2)throw Error('Unique source anchor missing');return s.replace(before,after);}
await existing('src/lib/dashboard.functions.ts','82880e381ba24aa8752454ed07780b6d2bdb46bad62dd549214bf29cc207ff00',s=>{
 const tenantEnd=s.indexOf('const DASHBOARD_MAX_PAGE_REQUESTS');const tenantBefore=s.slice(0,tenantEnd);
 s=replaceOnce(s,'import { z } from "zod";','import { z } from "zod";\nimport { loadWorkspaceTeamMetrics } from "@/lib/workspace-dashboard-team-aggregate";');
 s=replaceOnce(s,'    if (teamDefinitionIds.length > 1_000) {\n      throw new Error("Team dashboard scope exceeds the supported limit. No partial totals were returned.");\n    }','');
 s=replaceOnce(s,'    const window = utcDashboardWindow(new Date(), W);','    if (scope === "team") {\n      return loadWorkspaceTeamMetrics((name, args) => (supabase as any).rpc(name, args), t, W);\n    }\n    const window = utcDashboardWindow(new Date(), W);');
 const noImport=s.replace('import { loadWorkspaceTeamMetrics } from "@/lib/workspace-dashboard-team-aggregate";\n','');
 if(noImport.slice(0,noImport.indexOf('const DASHBOARD_MAX_PAGE_REQUESTS'))!==tenantBefore)throw Error('Unrelated Tenant dashboard branch changed');
 return s;
});
await existing('src/components/workspace-dashboard.tsx','a34544829e741c76993e8a39ee0ab3d6fdcef465f574182665a411ed032e8ed8',s=>{
 s=replaceOnce(s,'import { getWorkspaceAnalytics } from "@/lib/dashboard.functions";','import { getWorkspaceAnalytics } from "@/lib/dashboard.functions";\nimport { workspaceDashboardFailure } from "@/lib/workspace-dashboard-team-aggregate";');
 s=replaceOnce(s,'    refetchInterval: 5 * 60_000,','    retry: false,\n    refetchInterval: 5 * 60_000,');
 s=replaceOnce(s,'Dashboard data could not be loaded. Check your connection and try again.','{scope === "team" ? workspaceDashboardFailure(q.error).message : "Dashboard data could not be loaded. Check your connection and try again."}');
 s=replaceOnce(s,'        <Button className="mt-3" size="sm" variant="outline" onClick={() => q.refetch()} disabled={q.isFetching}>\n          {q.isFetching ? "Retrying…" : "Retry"}\n        </Button>',
 '        <div className="mt-3 flex flex-wrap gap-2">\n          <Button size="sm" variant="outline" onClick={() => q.refetch()} disabled={q.isFetching}>\n            {q.isFetching ? "Retrying…" : scope === "team" ? "Retry Team metrics" : "Retry"}\n          </Button>\n          {scope === "team" && <Button size="sm" variant="outline" onClick={() => setScope("my")}>Return to My metrics</Button>}\n        </div>');
 if(!s.includes('option.value === scope ? "selected" : "ghost"'))throw Error('Approved gold selected scope was lost');return s;
});
for(const f of [ready.runtime[2],...ready.tests,ready.sql]){
 const source=await readFile(candidate+'/'+f.path);if(sha(source)!==(f.sha256??f.postimageSha256))throw Error('Qualified addition drift: '+f.path);
 try{await access(packet+'/'+f.path);throw Error('Unexpected addition preimage: '+f.path);}catch(e){if(e.code!=='ENOENT')throw e;}
 edits.push({rel:f.path,before:null,after:source,beforeSha256:null,afterSha256:sha(source)});
}
const routeRel='src/routes/_authenticated/$slug/workspace.tsx';
const routeBefore=await readFile(packet+'/'+routeRel);const routeHash=sha(routeBefore);
await existing(routeRel,routeHash,s=>{
 s=replaceOnce(s,'import { ReferenceDataTab } from "@/components/reference-data-tab";','import { ReferenceDataTab } from "@/components/reference-data-tab";\nimport { getReferenceWorkspaceReadAccess } from "@/lib/reference-scoped-read.functions";');
 const anchor='  // Always keep dashboard reachable so users never see a blank shell.\n  disabledPages.delete("dashboard");';
 const additions=`  const referencePermission = WORKSPACE_PAGES.find((item) => item.key === "reference")?.permission;
  const normalReferenceRead = permSet == null || !referencePermission || permSet.has(referencePermission);
  const fetchReferenceAdmission = useServerFn(getReferenceWorkspaceReadAccess);
  const referenceAdmission = useQuery({
    queryKey: ["reference-workspace-read-admission", user.id, tenant.id],
    queryFn: () => fetchReferenceAdmission({ data: { tenant_id: tenant.id } }),
    enabled: !access.isLoading && !normalReferenceRead && !visQ.isLoading && !visQ.isError && !disabledPages.has("reference"),
    staleTime: 0,
    refetchInterval: 30_000,
    retry: false,
  });
  const referenceResourceRead = !normalReferenceRead && !access.isLoading && !visQ.isLoading && !visQ.isError && !disabledPages.has("reference") && referenceAdmission.isSuccess && referenceAdmission.data?.allowed === true && referenceAdmission.data?.source === "reference_resource_view";
  const effectivePagePermission = page === "reference" && referenceResourceRead ? null : currentPageDef?.permission ?? null;`;
 s=replaceOnce(s,anchor,anchor+'\n'+additions);
 s=replaceOnce(s,'    if (disabledPages.has(key)) return false;','    if (disabledPages.has(key)) return false;\n    if (key === "reference" && referenceResourceRead) return true;');
 s=replaceOnce(s,'permission={currentPageDef?.permission ?? null}','permission={effectivePagePermission}');
 s=replaceOnce(s,'<ReferenceDataTab tenantId={tenant.id} />','<ReferenceDataTab tenantId={tenant.id} canWrite={referenceResourceRead ? false : canWrite} />');
 return s;
});
await mkdir(backup,{recursive:true});
for(const e of edits)if(e.before){await mkdir(path.dirname(backup+'/'+e.rel),{recursive:true});await writeFile(backup+'/'+e.rel,e.before);}
await writeFile(backup+'/prepared.json',JSON.stringify({at:new Date().toISOString(),phase:'prepared',files:edits.map(({before,after,...x})=>x)},null,2));
for(const e of edits){await mkdir(path.dirname(packet+'/'+e.rel),{recursive:true});await writeFile(packet+'/'+e.rel,e.after);if(sha(await readFile(packet+'/'+e.rel))!==e.afterSha256)throw Error('Integration readback failed');}
await writeFile(backup+'/receipt.json',JSON.stringify({at:new Date().toISOString(),phase:'SOURCE_INTEGRATED_NOT_DEPLOYED',tenantRollingWindowPreserved:true,goldSelectedScopePreserved:true,referenceAdmission:'current actor+tenant+positive server resource view only; tenant page disabled honored; fallback read-only',files:edits.map(({before,after,...x})=>x)},null,2));
console.log(JSON.stringify({integratedFiles:edits.length,tenantRollingWindowPreserved:true,goldScopePreserved:true,referenceRouteWired:true,phase:'source-only',receipt:backup+'/receipt.json'}));
