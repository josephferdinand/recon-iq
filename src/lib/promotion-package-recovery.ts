import { z } from "zod";
const mapping=z.object({sourceKey:z.string().max(180),mode:z.enum(["reuse","create"]),targetId:z.string().nullable(),targetName:z.string().max(120),targetRevision:z.string().nullable()}).strict();
export const promotionDraftSchema=z.object({target:z.string().max(180),root:z.string().max(180),team:z.string().max(180),reason:z.string().max(1000),selected:z.array(z.string().max(180)).max(250),id:z.string().nullable(),note:z.string().max(1000),mappings:z.array(mapping).max(250),envelope:z.string().max(2_000_000)}).strict();
const recordSchema=z.object({version:z.literal(1),actorId:z.string().min(1).max(180),tenantId:z.string().min(1).max(180),requestKey:z.string().uuid(),operation:z.enum(["request","sourceApprove","sourceReject","map","accept","reject","withdraw","receive"]),draft:promotionDraftSchema}).strict();
export type PromotionRecovery = z.infer<typeof recordSchema>;
type StoragePort=Pick<Storage,"getItem"|"setItem"|"removeItem">;
const storageKey=(tenantId:string,actorId:string)=>"fvi:promotion:v1:"+encodeURIComponent(tenantId)+":"+encodeURIComponent(actorId);
export function savePromotionRecovery(storage:StoragePort,record:PromotionRecovery){
 const safe=recordSchema.parse(record),encoded=JSON.stringify(safe);
 if(/(?:Bearer\s+\S+|eyJ[\w-]{20,}\.[\w-]{20,}\.|sb_secret_[\w-]+|sk-[\w-]{20,})/i.test(encoded))throw Error("Private credentials cannot enter promotion recovery");
 // Persist BEFORE sending a mutation; storage failure means no operation should be sent.
 storage.setItem(storageKey(safe.tenantId,safe.actorId),encoded);
}
export function loadPromotionRecovery(storage:StoragePort,tenantId:string,actorId:string):PromotionRecovery|null{
 const value=storage.getItem(storageKey(tenantId,actorId));if(value===null)return null;
 if(value.length>2_100_000)throw Error("Retained promotion recovery exceeds its bound");
 const safe=recordSchema.parse(JSON.parse(value));
 if(safe.tenantId!==tenantId||safe.actorId!==actorId)throw Error("Retained promotion recovery identity differs");
 return safe;
}
export function clearPromotionRecovery(storage:StoragePort,tenantId:string,actorId:string){storage.removeItem(storageKey(tenantId,actorId));}
