import type { Resource, ResourceKey } from "./promotion-package.protocol";
/** Browser-safe dependency preview. Server pinning and current authorization remain authoritative. */
export function promotionSelection(root:ResourceKey,team:ResourceKey,selected:ResourceKey[],inventory:Resource[]){
 const all=new Map(inventory.map(r=>[r.key,r]));
 if(all.size!==inventory.length)throw Error("Ambiguous resource inventory; refresh before selecting");
 const start=all.get(root);if(!start||start.kind!=="reconciliation")throw Error("Select an accessible reconciliation");
 const group=all.get(team);if(!group||group.kind!=="group")throw Error("Select an accessible requesting group");
 const walk=(keys:ResourceKey[])=>{const result=new Map<ResourceKey,Resource>(),visiting=new Set<ResourceKey>();
  const visit=(key:ResourceKey)=>{if(visiting.has(key))throw Error("Dependency cycle; refresh source configuration");if(result.has(key))return;
   const resource=all.get(key);if(!resource||resource.tenantId!==start.tenantId)throw Error("Required dependency unavailable in this tenant");
   if(!Array.isArray(resource.dependencies))throw Error("Dependency inventory incomplete; refresh before review");
   visiting.add(key);resource.dependencies.forEach(visit);visiting.delete(key);result.set(key,resource);if(result.size>250)throw Error("Package exceeds 250 dependencies");};keys.forEach(visit);return result;};
 const required=walk([root,team]),closure=walk([root,team,...selected]);
 return [...closure.values()].sort((a,b)=>a.key.localeCompare(b.key)).map(resource=>({resource,required:required.has(resource.key)}));
}
