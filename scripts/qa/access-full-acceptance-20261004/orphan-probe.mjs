import {writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {signIn,tenant,out,rest,journal} from './common.mjs';
import {server} from './server.mjs';
const state=JSON.parse(await readFile(path.join(out,'OWNED.json'),'utf8'));
const actor=await signIn('volta-recon-dataprep');if(!actor.tenantAdmin||actor.platformAdmin)throw Error('Pure tenant-admin required');
const name='Euler owned no-BU negative '+randomUUID().slice(0,8),result={at:new Date().toISOString(),name,actor:actor.id,tenant,ownerExpectation:'every new group must belong to a BU',businessMutationScope:'new owned group only'};
await journal({phase:'intent',operation:'new owned no-BU negative createGroup',args:{tenant_id:tenant,name}});
const created=await server(actor,'createGroup',{tenant_id:tenant,name,description:'New owned negative QA fixture; if orphan is accepted immediately associate to owned BU'});result.create=created;
await writeFile(path.join(out,'ORPHAN-PROBE.json'),JSON.stringify(result,null,2),{flag:'wx'});
if(!created.error&&created.data?.id){
 result.before=await rest(actor,'tenant_groups',{select:'id,bu_id,created_by,name',tenant_id:'eq.'+tenant,id:'eq.'+created.data.id});
 result.actualGap=result.before.http===200&&result.before.data[0]?.bu_id===null;
 await writeFile(path.join(out,'ORPHAN-PROBE.json'),JSON.stringify(result,null,2));
 const repaired=await server(actor,'updateGroup',{tenant_id:tenant,group_id:created.data.id,bu_id:state.owned.bu});result.ownedRepair=repaired;
 if(repaired.error)throw Error('New owned orphan association refused; preserve ID for parent');
 result.buAssociation=await server(actor,'assignBuGroup',{tenant_id:tenant,bu_id:state.owned.bu,group_id:created.data.id,role:'bu_member',inherit_descendants:false});
 result.after=await rest(actor,'tenant_groups',{select:'id,bu_id,created_by',tenant_id:'eq.'+tenant,id:'eq.'+created.data.id});
 result.ownedOrphanNowAssociated=result.after.data?.[0]?.bu_id===state.owned.bu;
 result.retainedAudit=await rest(actor,'audit_log',{select:'id,action,resource_id',tenant_id:'eq.'+tenant,resource_id:'eq.'+created.data.id});
}
await writeFile(path.join(out,'ORPHAN-PROBE.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({actualGap:result.actualGap??false,newGroup:created.data?.id,ownedOrphanNowAssociated:result.ownedOrphanNowAssociated??null,auditRows:result.retainedAudit?.data?.length}));
