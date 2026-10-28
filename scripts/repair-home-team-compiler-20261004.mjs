import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root='./LOCAL_USER/AppData/Local/Temp/fvi-codex-docs-release-20260930';
const output='./LOCAL_USER/AppData/Local/Temp/fvi-codex-audit-20260930-4746723/home-team-compiler-repair-20261004';
mkdirSync(output,{recursive:true});
const sha=s=>createHash('sha256').update(s).digest('hex');
const receipts=[];
function edit(path,fn){const before=readFileSync(`${root}/${path}`,'utf8');const after=fn(before);if(after===before)throw Error(`No change: ${path}`);writeFileSync(`${output}/${path.split('/').at(-1)}.preimage`,before);writeFileSync(`${root}/${path}`,after);receipts.push({path,preimage:sha(before),postimage:sha(after)});}
function replace(source,from,to){if(!source.includes(from))throw Error(`Missing exact anchor: ${from.slice(0,100)}`);if(source.indexOf(from)!==source.lastIndexOf(from))throw Error(`Ambiguous anchor: ${from.slice(0,100)}`);return source.replace(from,to);}
edit('src/lib/workspace-dashboard-team-aggregate.ts',s=>{
 s=replace(s,'const metric = (v: z.ZodTypeAny)', 'const metric = <T extends z.ZodTypeAny>(v: T)');
 s=replace(s,'record_match_rate: value.nullable() }).passthrough()', 'record_match_rate: value.nullable(), completed_at: z.string().nullable().optional(), matched_count: count.nullable().optional(), exception_count: count.nullable().optional(), total_rows: count.nullable().optional() })');
 return s;
});
edit('src/lib/dashboard.functions.ts',raw=>{
 const s0=raw.replaceAll('\r\n','\n');let s=s0;
 s=replace(s,'    const teamDefinitionIds = scope === "team" ? (teamScope?.definitionIds ?? []) : [];\n\n    const teamScopeEmpty = scope === "team" && teamDefinitionIds.length === 0;\n','');
 s=replace(s,'    const emptyPageResult = { data: [] as any[], error: null as unknown | null };\n','');
 s=replace(s,'\n      if (scope === "team") query = query.in("definition_id", teamDefinitionIds);\n','\n');
 s=replace(s,'    const loadRuns = (previous: boolean) => scope === "team" && teamDefinitionIds.length === 0\n      ? Promise.resolve(emptyPageResult)\n      : fetchAllPages','    const loadRuns = (previous: boolean) => fetchAllPages');
 s=replace(s,'      if (scope === "team") return query.in("run.definition_id", teamDefinitionIds);\n','');
 s=replace(s,'      if (scope === "team" && teamDefinitionIds.length === 0) return Promise.resolve(emptyPageResult);\n','');
 s=s.replaceAll('${scope === "team" ? "!inner" : ""}','');
 s=replace(s,'    const emptyUnavailable = { data: null, error: new Error("No team-scoped data contract exists for this relation") };\n    const loadTickets = scope === "team"\n      ? Promise.resolve(emptyUnavailable)\n      : fetchAllPages','    const loadTickets = fetchAllPages');
 s=replace(s,'    const loadDefinitions = () => scope === "team" && teamDefinitionIds.length === 0\n      ? Promise.resolve(emptyPageResult)\n      : fetchAllPages','    const loadDefinitions = () => fetchAllPages');
 s=replace(s,'        if (scope === "team") query = query.in("id", teamDefinitionIds);\n','');
 s=replace(s,'    const loadAiUsage = scope === "team"\n      ? Promise.resolve(emptyUnavailable)\n      : fetchAllPages','    const loadAiUsage = fetchAllPages');
 s=replace(s,'    const loadSchedules = () => scope === "team" && teamDefinitionIds.length === 0\n      ? Promise.resolve(emptyPageResult)\n      : fetchAllPages','    const loadSchedules = () => fetchAllPages');
 s=replace(s,'        if (scope === "team") query = query.in("definition_id", teamDefinitionIds);\n','');
 const start=s.indexOf('    if (scope === "team" && recons.error) {');const finish=s.indexOf('      : await fetchAllPages((from, to) => {',start);
 if(start<0||finish<start)throw Error('Missing obsolete Team row path');
 s=s.slice(0,start)+'    const dsRows = await fetchAllPages((from, to) => {'+s.slice(finish+'      : await fetchAllPages((from, to) => {'.length);
 s=replace(s,'      scope_empty: scope === "team" && teamDefinitionIds.length === 0,','      scope_empty: false,');
 s=replace(s,'        : scope === "team"\n          ? "Team scope: data is limited to reconciliations your account can read through current same-tenant BU/group assignments and grants. This is not a tenant-wide total."\n          : "Tenant scope:', '        : "Tenant scope:');
 if(s.includes('teamDefinitionIds')||s.includes('teamScopeEmpty'))throw Error('Obsolete Team fallback remains');
 if(s.slice(s.indexOf('return loadWorkspaceTeamMetrics')).slice(150).includes('scope === "team"'))throw Error('Unreachable Team branch remains');
 return raw.includes('\r\n')?s.replaceAll('\n','\r\n'):s;
});
writeFileSync(`${output}/receipt.json`,JSON.stringify({at:new Date().toISOString(),scope:'Home Team return DTO and obsolete capped Team branches only',sourceOnly:true,receipts},null,2));
console.log(JSON.stringify(receipts));
