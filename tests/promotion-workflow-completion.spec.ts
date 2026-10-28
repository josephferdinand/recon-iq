import { describe, expect, it } from "vitest";
import { promotionSelection } from "@/lib/promotion-package-selection";
import { savePromotionRecovery, loadPromotionRecovery, clearPromotionRecovery, type PromotionRecovery } from "@/lib/promotion-package-recovery";
import type { Resource, ResourceKey } from "@/lib/promotion-package.protocol";
const r=(kind:Resource["kind"],id:string,dependencies:ResourceKey[]=[],tenantId="source"):Resource=>({kind,id,key:`${kind}:${id}`,tenantId,name:id,revision:"2026-10-04T00:00:00Z",dependencies,configuration:{}});
const inventory=[r("business_unit","BU"),r("group","User_View",["business_unit:BU"]),r("source","input",["business_unit:BU"]),r("data_prep","pipeline",["source:input"]),r("reconciliation","root",["data_prep:pipeline"]),r("report","saved-report",["reconciliation:root"]),r("settings","non-security-config")];
const record:PromotionRecovery={version:1,actorId:"maker",tenantId:"source",requestKey:"11111111-1111-4111-8111-111111111111",operation:"request",draft:{target:"target",root:"reconciliation:root",team:"group:User_View",reason:"Reviewed movement reason",selected:["report:saved-report"],id:null,note:"",mappings:[],envelope:""}};
function store(){const values=new Map<string,string>();return {values,getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};}
describe("promotion dependency selection and durable unknown-outcome contract",()=>{
 it("shows full mandatory source/pipeline/BU/group closure and selected optional report/settings",()=>{
  const selected=promotionSelection("reconciliation:root","group:User_View",["report:saved-report","settings:non-security-config"],inventory);
  expect(selected.filter(x=>x.required).map(x=>x.resource.key).sort()).toEqual(["business_unit:BU","data_prep:pipeline","group:User_View","reconciliation:root","source:input"]);
  expect(selected.filter(x=>!x.required).map(x=>x.resource.key).sort()).toEqual(["report:saved-report","settings:non-security-config"]);
 });
 it("cannot drop a required dependency by deselecting optional dependencies",()=>{expect(promotionSelection("reconciliation:root","group:User_View",[],inventory).map(x=>x.resource.key)).toContain("source:input");});
 it("refuses unavailable references without inventing them",()=>{expect(()=>promotionSelection("reconciliation:root","group:User_View",[],inventory.filter(x=>x.kind!=="source"))).toThrow("unavailable");});
 it("refuses graph cycles",()=>{const changed=inventory.map(x=>x.kind==="source"?{...x,dependencies:["reconciliation:root" as ResourceKey]}:x);expect(()=>promotionSelection("reconciliation:root","group:User_View",[],changed)).toThrow("cycle");});
 it("refuses cross-tenant BU/group dependencies",()=>{expect(()=>promotionSelection("reconciliation:root","group:User_View",[],inventory.map(x=>x.kind==="business_unit"?{...x,tenantId:"other"}:x))).toThrow("this tenant");});
 it("refuses ambiguous duplicate inventory",()=>{expect(()=>promotionSelection("reconciliation:root","group:User_View",[],[...inventory,inventory[0]])).toThrow("Ambiguous");});
 it("persists exact key and draft before a request and restores after remount",()=>{const storage=store();savePromotionRecovery(storage,record);expect(loadPromotionRecovery(storage,"source","maker")).toEqual(record);});
 it("refuses storage failure before sending anything",()=>{expect(()=>savePromotionRecovery({...store(),setItem:()=>{throw Error("Quota exceeded");}},record)).toThrow("Quota");});
 it("never restores another actor or tenant's pending operation",()=>{const storage=store();savePromotionRecovery(storage,record);expect(loadPromotionRecovery(storage,"source","checker")).toBeNull();expect(loadPromotionRecovery(storage,"other","maker")).toBeNull();});
 it("clears only the confirmed current actor/tenant record",()=>{const storage=store();savePromotionRecovery(storage,record);savePromotionRecovery(storage,{...record,actorId:"checker"});clearPromotionRecovery(storage,"source","maker");expect(loadPromotionRecovery(storage,"source","maker")).toBeNull();expect(loadPromotionRecovery(storage,"source","checker")).not.toBeNull();});
 it("does not treat a damaged record as permission to retry",()=>{const storage=store();savePromotionRecovery(storage,record);storage.values.set([...storage.values.keys()][0],"{bad");expect(()=>loadPromotionRecovery(storage,"source","maker")).toThrow();});
 it("rejects credential-shaped draft material and forged authority fields",()=>{const storage=store();expect(()=>savePromotionRecovery(storage,{...record,draft:{...record.draft,reason:"Bearer private-value"}})).toThrow("credentials");expect(()=>savePromotionRecovery(storage,{...record,aal2:true} as any)).toThrow();});
});
