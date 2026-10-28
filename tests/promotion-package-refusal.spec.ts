import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
vi.mock("@/lib/environment-package-file.server",()=>({signEnvironmentPackage:vi.fn(),verifyEnvironmentPackage:vi.fn()}));
import { SupabasePromotionGateway } from "@/lib/promotion-package.server";
const actor={id:"verified-actor",tenantId:"tenant",active:true,tenantAdmin:true,canRequest:true,aal2:true};
const command={operation:"map" as const,id:"movement",expectedRevision:3,key:"nonce",body:{mappings:[]}};
describe("promotion deterministic RPC refusal vs uncertain transport",()=>{
 it("classifies actual PT409 as a refused transaction and binds the server-derived actor",async()=>{
  const rpc=vi.fn().mockResolvedValue({data:null,error:{code:"PT409",message:"private SQL trace"}}),gateway=new SupabasePromotionGateway({} as any,{rpc} as any,"verified-actor","runtime-project");
  await expect(gateway.commit(actor,command)).rejects.toThrow(/^Blocked:/);expect(rpc.mock.calls[0][1]._actor).toBe("verified-actor");expect(rpc.mock.calls[0][1]._command.runtimeProjectRef).toBe("runtime-project");
 });
 it("keeps transport uncertainty distinct and does not leak provider messages",async()=>{
  const rpc=vi.fn().mockRejectedValue(Error("private provider trace")),gateway=new SupabasePromotionGateway({} as any,{rpc} as any,"verified-actor","runtime-project");
  await expect(gateway.commit(actor,command)).rejects.toThrow("outcome is unconfirmed");
 });
 it("proposed SQL changes only four custom refusal codes, retaining all atomic audit/nonce/mapping semantics",async()=>{
  const old=await readFile("supabase/migrations/20261003110000_dynamic_promotion_package_workflow.sql","utf8"),proposed=await readFile("scripts/qa/output/promotion-workflow-completion-20261004/PROPOSED_DYNAMIC_PROMOTION_PT409.sql","utf8");
  expect(old.match(/ERRCODE='40001'/g)).toHaveLength(4);expect(proposed).toBe(old.replaceAll("ERRCODE='40001'","ERRCODE='PT409'"));
 });
});
