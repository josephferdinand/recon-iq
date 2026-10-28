import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {createTwoFilesPatch} from 'diff';
import {out,sha} from './common.mjs';
const candidate='./LOCAL_USER/AppData/Local/Temp/fvi-codex-docs-release-20260930';
const files=['src/lib/groups.functions.ts','src/lib/business-units.functions.ts','src/components/groups-tab.tsx'];
const strict=`async function assertAdmin(ctx: any, tenantId: string) {\n  const { data, error } = await ctx.supabase.rpc("has_tenant_role", {\n    _user_id: ctx.userId, _tenant_id: tenantId, _role: "tenant_admin",\n  });\n  if (error || data !== true) throw new Error("Forbidden: tenant_admin required");\n}`;
const bu=`async function assertGroupBu(ctx: any, tenantId: string, buId: string) {\n  const { data, error } = await ctx.supabase.from("business_units")\n    .select("id").eq("tenant_id", tenantId).eq("id", buId)\n    .eq("is_archived", false).maybeSingle();\n  if (error || !data) throw new Error("Select an active Business Unit in this tenant.");\n}\n\n`;
const inspect=`async function assertInspectableSubject(ctx: any, tenantId: string, userId: string) {\n  if (userId === ctx.userId) return;\n  const [platform, tenant] = await Promise.all([\n    ctx.supabase.rpc("is_platform_admin", { _user_id: ctx.userId }),\n    ctx.supabase.rpc("has_tenant_role", { _user_id: ctx.userId, _tenant_id: tenantId, _role: "tenant_admin" }),\n  ]);\n  if (platform.error || tenant.error || (platform.data !== true && tenant.data !== true)) {\n    throw new Error("Forbidden: administrative access required to inspect another user.");\n  }\n}\n\n`;
function replaceExact(text,old,next){if(!text.includes(old)||text.split(old).length!==2)throw Error('Exact unique preimage missing: '+old.slice(0,65));return text.replace(old,next);}
function change(file,text){
 const newline=text.includes('\r\n')?'\r\n':'\n';let s=text.replaceAll('\r\n','\n');
 if(file.includes('.functions.ts')){
  const start=s.indexOf('async function assertAdmin('),end=s.indexOf('\n\n',s.indexOf('\n}',start));if(start<0||end<start)throw Error('Admin helper preimage absent');s=s.slice(0,start)+strict+s.slice(end);
 }
 if(file.endsWith('groups.functions.ts')){
  s=replaceExact(s,'async function audit(ctx: any, row: Record<string, unknown>) {',bu+inspect+'async function audit(ctx: any, row: Record<string, unknown>) {');
  s=replaceExact(s,'    const { data: rows, error } = await context.supabase\n      .rpc("effective_user_permissions", {','    await assertInspectableSubject(context, data.tenant_id, data.user_id);\n    const { data: rows, error } = await context.supabase\n      .rpc("effective_user_permissions", {');
  s=replaceExact(s,'      bu_id: uuid.nullish(),','      bu_id: uuid,');
  s=replaceExact(s,'    await assertAdmin(context, data.tenant_id);\n    const { data: row, error } = await context.supabase.from("tenant_groups")','    await assertAdmin(context, data.tenant_id);\n    await assertGroupBu(context, data.tenant_id, data.bu_id);\n    const { data: row, error } = await context.supabase.from("tenant_groups")');
  // Only explicit reassociation changes are required to provide a BU; legacy name edits remain possible.
  s=replaceExact(s,'      bu_id: uuid.nullable().optional(),','      bu_id: uuid.optional(),');
  s=replaceExact(s,'    const patch: Record<string, unknown> = {};','    if (data.bu_id !== undefined) await assertGroupBu(context, data.tenant_id, data.bu_id);\n    const patch: Record<string, unknown> = {};');
 }else if(file.endsWith('groups-tab.tsx')){
  const restIndex=s.indexOf('function PresetsList(');if(restIndex<0)throw Error('Exact group form scope boundary missing');const rest=s.slice(restIndex);s=s.slice(0,restIndex);
  s=replaceExact(s,'bu_id: buId || undefined','bu_id: buId');
  s=replaceExact(s,'Bundle users; assign roles in bulk. Optionally scope a group to a Business Unit.','Bundle users and assign roles within a Business Unit.');
  s=replaceExact(s,'<Label>Business Unit (optional)</Label>','<Label htmlFor="group-business-unit">Business Unit</Label>');
  s=replaceExact(s,'<SelectTrigger><SelectValue placeholder="Tenant-wide (no BU)" /></SelectTrigger>','<SelectTrigger id="group-business-unit" aria-required="true" aria-describedby="group-business-unit-help"><SelectValue placeholder="Select a Business Unit" /></SelectTrigger>');
  s=replaceExact(s,'{(busQ.data ?? []).map((b: any) => (','{(busQ.data ?? []).filter((b: any) => !b.is_archived).map((b: any) => (');
  s=replaceExact(s,'                </Select>\n              </div>','                </Select>\n                <p id="group-business-unit-help" className="mt-1 text-sm text-muted-foreground" aria-live="polite">\n                  {busQ.isError ? "Business Units could not be loaded. Close and retry." : busQ.isPending ? "Loading Business Units…" : !(busQ.data ?? []).some((b: any) => !b.is_archived) ? "Create an active Business Unit before adding a group." : "Every new group belongs to an active Business Unit."}\n                </p>\n              </div>');
  s=replaceExact(s,'disabled={!name || mCreate.isPending}','disabled={!name.trim() || !buId || busQ.isPending || busQ.isError || !(busQ.data ?? []).some((b: any) => b.id === buId && !b.is_archived) || mCreate.isPending}');
  s+=rest;
 }
 return newline==='\r\n'?s.replaceAll('\n','\r\n'):s;
}
await mkdir(path.join(out,'packet'),{recursive:true});const manifest={at:new Date().toISOString(),scope:'access only; tenant-admin authority and required group BU',sourceFiles:[],sharedSourceEdited:false,applyExecuted:false};
for(const [kind,base] of [['canonical',process.cwd()],['candidate',candidate]]){
 let patch='';
 for(const file of files){const before=await readFile(path.join(base,file),'utf8'),after=change(file,before),stem=kind+'-'+file.replaceAll('/','__');await writeFile(path.join(out,'packet',stem+'.preimage'),before);await writeFile(path.join(out,'packet',stem+'.proposed'),after);patch+=createTwoFilesPatch('a/'+file,'b/'+file,before,after,'','');manifest.sourceFiles.push({kind,file,preimageSha256:sha(before),postimageSha256:sha(after),preimage:path.join(out,'packet',stem+'.preimage'),proposed:path.join(out,'packet',stem+'.proposed')});}
 await writeFile(path.join(out,'packet',kind+'-access-only.patch'),patch);manifest[kind+'PatchSha256']=sha(patch);
}
await writeFile(path.join(out,'packet','MANIFEST.json'),JSON.stringify(manifest,null,2));console.log(JSON.stringify({packet:path.join(out,'packet'),files:manifest.sourceFiles.length,sharedSourceEdited:false}));
