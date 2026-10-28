import {describe,it,expect} from "vitest";
import {incidentDraftSchema} from "@/lib/status.model";
const planned={kind:"maintenance",severity:"minor",status:"scheduled",title:"Synthetic scheduled maintenance",summary:"Synthetic future maintenance fixture only.",impact:null,cell_keys:["production-current"],component_keys:["api"],function_keys:[],started_at:"2090-01-01T00:00:00Z",detected_at:null,resolved_at:null,occurred_at:"2025-01-01T00:00:00Z",planned_end_at:"2090-01-01T01:00:00Z",display_timezone:"UTC",correction_reason:null,root_cause:null,remediation:null,evidence_ref:"Synthetic maintenance schedule evidence",public_safe:true};
describe("planned maintenance actual dates",()=>{
 it("keeps a future planned window separate from actual announcement time",()=>{expect(incidentDraftSchema.safeParse(planned).success).toBe(true);});
 it("rejects future actual starts/announcements and reversed windows",()=>{for(const change of [{status:"in_progress"},{occurred_at:"2090-01-01T00:00:00Z"},{planned_end_at:"2089-12-31T00:00:00Z"}])expect(incidentDraftSchema.safeParse({...planned,...change}).success).toBe(false);});
});
