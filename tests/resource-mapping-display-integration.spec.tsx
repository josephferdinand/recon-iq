// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ResourceIdentitySummary } from "@/components/resource-identity-summary";
import { useResourceMappingDisplay } from "@/hooks/use-resource-mapping-display";
const mocks=vi.hoisted(()=>({summary:vi.fn(), session:vi.fn(), listener:null as any, unsubscribe:vi.fn(),
  sources:vi.fn(), details:vi.fn(), pipelines:vi.fn(), runs:vi.fn(), options:vi.fn(), actors:vi.fn()}));
vi.mock("@tanstack/react-start",()=>({useServerFn:(fn:unknown)=>fn}));
vi.mock("@/lib/resource-access-summaries.functions",()=>({getResourceAccessSummaries:mocks.summary}));
vi.mock("@/integrations/supabase/client",()=>({supabase:{auth:{getSession:mocks.session,onAuthStateChange:(fn:any)=>{mocks.listener=fn;return {data:{subscription:{unsubscribe:mocks.unsubscribe}}};}}}}));
vi.mock("@/hooks/use-access",()=>({useAccess:()=>({tenantRole:"tenant_viewer",has:()=>false,hasAny:()=>false,access:{user_id:"viewer"}})}));
vi.mock("@/lib/data-sources.functions",()=>({listDataSourcesPage:mocks.sources,getDataSource:mocks.details,listDataSourceOptions:mocks.options,createDataSource:vi.fn(),deleteDataSource:vi.fn(),registerUpload:vi.fn(),updateDataSource:vi.fn()}));
vi.mock("@/lib/data-prep.functions",()=>({listPipelines:mocks.pipelines,listPipelineRuns:mocks.runs,upsertPipeline:vi.fn(),deletePipeline:vi.fn(),approvePipeline:vi.fn(),cancelPipelineRun:vi.fn(),cloneAsStaging:vi.fn(),requestPromotion:vi.fn(),approvePromotion:vi.fn(),rejectPromotion:vi.fn(),discardStaging:vi.fn(),diffStaging:vi.fn(),listAffectedRecons:vi.fn()}));
vi.mock("@/lib/resource-actor-summaries.functions",()=>({getResourceActorSummaries:mocks.actors}));
vi.mock("@/components/typed-resource-access-editor",()=>({TypedResourceAccessEditor:()=> <div>Admin mapping editor</div>}));
vi.mock("@/components/confirm-dialog",()=>({useConfirm:()=>({confirm:vi.fn(),ConfirmDialog:null})}));
vi.mock("@/components/data-prep-request-recovery",()=>({DataPrepRequestRecovery:()=>null}));
vi.mock("sonner",()=>({toast:{success:vi.fn()}}));
import { DataSourcesTab } from "../scripts/qa/output/resource-mapping-display-20261004/postimages/src/components/data-sources-tab";
import { DataPrepTab } from "../scripts/qa/output/resource-mapping-display-20261004/postimages/src/components/data-prep-tab";
const tenant="11111111-1111-4111-8111-111111111111",id="22222222-2222-4222-8222-222222222222";
const row={id,name:"Owned QA input",source_type:"csv",status:"ready",row_count:1,inferred_schema:[],description:null,created_at:"2026-10-04",updated_at:"2026-10-04"};
const summary=(type="data_source")=>({available:true,rows:[{resource_type:type,resource_id:id,public_id:"QA-PUBLIC",access_state:"mapped",business_unit_names:["Treasury QA"],business_unit_count:1,user_group_names:["User_View"],user_group_count:1}]});
function mount(ui:ReactNode){const qc=new QueryClient({defaultOptions:{queries:{retry:false}}});const rendered=render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);return {...rendered,qc};}
function Harness({tenantId=tenant}:{tenantId?:string}){const q=useResourceMappingDisplay({tenantId,resourceType:"data_source",resourceIds:[id]});return <ResourceIdentitySummary mode="detail" summary={q.data.rows[0]} available={q.data.available}/>;}
beforeEach(()=>{vi.resetAllMocks();mocks.session.mockResolvedValue({data:{session:{user:{id:"viewer"}}},error:null});mocks.summary.mockResolvedValue(summary());mocks.actors.mockResolvedValue({available:true,rows:[]});mocks.sources.mockResolvedValue({rows:[row],total:1,total_pages:1,page:1,page_size:25});mocks.details.mockResolvedValue({...row,uploads:[]});mocks.pipelines.mockResolvedValue({rows:[{...row,public_uid:"PIPE-QA",steps:[],dq_rules:[],version:1}],total:1});mocks.runs.mockResolvedValue([]);mocks.options.mockResolvedValue({rows:[]});});
afterEach(()=>cleanup());
describe("actual proposed page summary integration",()=>{
  it("renders authorized FILE BU/User_View metadata without admin editor or upload action",async()=>{
    mount(<DataSourcesTab tenantId={tenant} canWrite={false}/>);
    expect((await screen.findAllByText("User_View")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Treasury QA").length).toBeGreaterThan(0);
    expect(screen.queryByText("Admin mapping editor")).toBeNull();
    expect(screen.queryByRole("button",{name:"New data source"})).toBeNull();
    expect(mocks.summary).toHaveBeenCalledWith({data:{resource_type:"data_source",resource_ids:[id]}});
  });
  it("DataPrep proposed list renders actual mapping names with ordinary permissions intact",async()=>{
    mocks.summary.mockResolvedValue(summary("data_prep_pipeline"));
    mount(<DataPrepTab tenantId={tenant} canWrite={false}/>);
    expect((await screen.findAllByText("User_View")).length).toBeGreaterThan(0);
    expect(screen.queryByText("Admin mapping editor")).toBeNull();
    expect(mocks.summary).toHaveBeenCalledWith({data:{resource_type:"data_prep_pipeline",resource_ids:[id]}});
  });
  it("does not label an omitted scoped mapping as None/Unassigned",async()=>{
    mocks.summary.mockResolvedValue({available:true,rows:[]});mount(<Harness/>);
    expect(await screen.findByText("Access mapping unavailable")).toBeTruthy();
    expect(screen.queryByText("Unassigned")).toBeNull();expect(screen.queryByText("User groups: None")).toBeNull();
  });
  it("removes successful names immediately during refresh and after a transport failure",async()=>{
    const {qc}=mount(<Harness/>);await screen.findByText("User_View");
    let reject!:(e:Error)=>void;mocks.summary.mockImplementationOnce(()=>new Promise((_ok,bad)=>{reject=bad;}));
    act(()=>{void qc.invalidateQueries({queryKey:["resource-access-summary",tenant,"data_source"]});});
    await screen.findByText("Access mapping unavailable");expect(screen.queryByText("User_View")).toBeNull();
    await act(async()=>reject(new Error("Provider unavailable")));
    await waitFor(()=>expect(qc.getQueryCache().find({queryKey:["resource-access-summary",tenant,"data_source","viewer",[id]]})?.state.status).toBe("error"));
    await waitFor(()=>expect(screen.queryByText("User_View")).toBeNull());
  });
  it("refresh after revocation and recovery shows current response, not a cached grant",async()=>{
    const {qc}=mount(<Harness/>);await screen.findByText("User_View");
    mocks.summary.mockResolvedValueOnce({available:true,rows:[]});await act(async()=>{await qc.invalidateQueries({queryKey:["resource-access-summary",tenant,"data_source"]});});
    await waitFor(()=>expect(screen.queryByText("User_View")).toBeNull());
    mocks.summary.mockResolvedValueOnce(summary());await act(async()=>{await qc.invalidateQueries({queryKey:["resource-access-summary",tenant,"data_source"]});});await screen.findByText("User_View");
  });
  it("same resource IDs cannot reuse another actor's names across sign-out and sign-in",async()=>{
    mount(<Harness/>);await screen.findByText("User_View");
    await act(async()=>mocks.listener("SIGNED_OUT",null));expect(screen.queryByText("User_View")).toBeNull();
    mocks.summary.mockResolvedValueOnce({available:true,rows:[]});await act(async()=>mocks.listener("SIGNED_IN",{user:{id:"other-viewer"}}));
    await waitFor(()=>expect(mocks.summary).toHaveBeenCalledTimes(2));expect(screen.queryByText("User_View")).toBeNull();
  });
  it("late initial session cannot restore a signed-out actor",async()=>{
    let resolve!:(x:any)=>void;mocks.session.mockImplementationOnce(()=>new Promise(ok=>{resolve=ok;}));mount(<Harness/>);
    await act(async()=>mocks.listener("SIGNED_OUT",null));await act(async()=>resolve({data:{session:{user:{id:"old-admin"}}},error:null}));
    expect(mocks.summary).not.toHaveBeenCalled();expect(screen.queryByText("User_View")).toBeNull();
  });
  it("retains gold View and sidebar-selected styling in actual FILE page",async()=>{
    mount(<DataSourcesTab tenantId={tenant} canWrite={false}/>);await screen.findByText("Owned QA input");
    const view=screen.getByRole("button",{name:"View Owned QA input"});expect(view.className).toContain("fvi-row-view-action");fireEvent.click(screen.getByText("Owned QA input"));
    expect(screen.getByText("Owned QA input").closest("tr")?.className).toContain("fvi-selected-row");
  });
});
