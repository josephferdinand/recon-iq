import {signIn,actorProof,rest,rpc,evidence,appReadback,tenant} from './common.mjs';
const results={at:new Date().toISOString(),app:await appReadback(),actors:[],metadata:{},businessMutations:0};
for(const label of ['nonadmin-analyst','kepler-scoped-observer','kepler-org-admin','volta-recon-dataprep']){
 const a=await signIn(label);const proof=actorProof(a);results.actors.push(proof);
 if(label==='nonadmin-analyst'||label==='kepler-scoped-observer'){if(a.tenantAdmin||a.platformAdmin||a.role.length!==1||!a.role[0].active)throw Error('Negative actor has privileged authority');}
 if(label==='kepler-org-admin'){
  for(const [table,select] of [['workspaces','id,name,business_unit_id,status,created_by'],['business_units','id,name,created_by'],['rbac_roles','id,key,name,is_system'],['permissions','id,resource,action']]){
   const params={select,...(table==='permissions'?{}:table==='rbac_roles'?{or:'(tenant_id.is.null,tenant_id.eq.'+tenant+')'}:{tenant_id:'eq.'+tenant}),limit:'100'};
   const r=await rest(a,table,params);results.metadata[table]=r;
  }
 }
 const opts=await rpc(a,'list_governance_membership_options',{_tenant_id:tenant,_kind:'bu',_page:1,_page_size:25,_search:'',_bu_id:null,_workspace_id:null,_environment:'prod'});proof.buOptions={http:opts.http,rows:opts.data?.rows?.map(x=>({id:x.id,name:x.name})),error:opts.data?.code};
 console.log(JSON.stringify(proof));
}
await evidence('PREFLIGHT-'+Date.now()+'.json',results);console.log(JSON.stringify({actors:results.actors.length,businessMutations:0}));
