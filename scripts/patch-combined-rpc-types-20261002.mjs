import {readFile,writeFile} from 'node:fs/promises';
const roots=['./LOCAL_USER/AppData/Local/Temp/fvi-codex-docs-release-20260930','./LOCAL_USER/OneDrive - 8gsp1y/Documents/ChatGPT/ReconIQ'];
const functions={
 get_workspace_dashboard_team_scope:'Args: { _tenant_id: string }; Returns: Json',
 recon_authoritative_access_decision:'Args: { _recon: string; _action: string }; Returns: boolean',
 review_proposed_match_scoped:'Args: { _tenant_id: string; _match_id: string; _decision: string; _note?: string | null }; Returns: Json',
 review_proposed_matches_scoped:'Args: { _tenant_id: string; _match_ids: string[]; _decision: string }; Returns: Json',
};
for(const root of roots){
 const file=root+'/src/integrations/supabase/types.ts';let text=await readFile(file,'utf8');const nl=text.includes('\r\n')?'\r\n':'\n';
 const publicStart=text.indexOf(nl+'  public: {');if(publicStart<0)throw Error('Public namespace not found');
 const functionStart=text.indexOf(nl+'    Functions: {',publicStart);if(functionStart<0)throw Error('Public function type namespace not found');
 const functionEnd=text.indexOf(nl+'    Enums:',functionStart);if(functionEnd<0)throw Error('Public function namespace end not found');
 let fnBlock=text.slice(functionStart,functionEnd),added=[];
 for(const [name,definition]of Object.entries(functions))if(!new RegExp('^      '+name+':','m').test(fnBlock)){fnBlock=fnBlock.replace(nl+'    Functions: {',nl+'    Functions: {'+nl+'      '+name+': { '+definition+' }');added.push(name);}
 text=text.slice(0,functionStart)+fnBlock+text.slice(functionEnd);
 const tableStart=text.indexOf('      recon_definitions: {',publicStart);if(tableStart<0)throw Error('Verified recon_definitions table type absent');
 const tail=text.slice(tableStart+1),match=/\r?\n      [a-zA-Z0-9_]+: \{/u.exec(tail);const tableEnd=match?tableStart+1+match.index:text.indexOf(nl+'    Views:',tableStart);
 let block=text.slice(tableStart,tableEnd),columnAdded=false;
 if(!block.includes('governance_state:')&&!block.includes('governance_state?:')){
  let count=0;block=block.replace(/(        (Row|Insert|Update): \{\r?\n)/gu,(_,prefix,kind)=>{count++;return prefix+'          governance_state'+(kind==='Row'?'': '?')+': string'+nl;});if(count!==3)throw Error('Expected verified Row/Insert/Update shapes');columnAdded=true;
 }
 text=text.slice(0,tableStart)+block+text.slice(tableEnd);await writeFile(file,text);
 console.log(JSON.stringify({file,addedRpcTypes:added,verifiedGovernanceStateColumnAdded:columnAdded,sqlOrRuntimeBehaviorChanged:false}));
}
