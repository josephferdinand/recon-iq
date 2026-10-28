// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
const mocks=vi.hoisted(()=>({summary:vi.fn(),session:vi.fn(),listeners:new Set<any>(),templates:vi.fn(),documents:vi.fn(),sources:vi.fn(),details:vi.fn(),actors:vi.fn(),unsubscribe:vi.fn(),create:vi.fn(),approve:vi.fn(),upsert:vi.fn(),remove:vi.fn()}));
vi.mock("@tanstack/react-start",()=>({useServerFn:(fn:unknown)=>fn}));
vi.mock("@tanstack/react-router",()=>({Link:({children,to,...props}:any)=><a href={to} {...props}>{children}</a>}));
vi.mock("@/lib/resource-access-summaries.functions",()=>({getResourceAccessSummaries:mocks.summary}));
vi.mock("@/integrations/supabase/client",()=>({supabase:{auth:{getSession:mocks.session,onAuthStateChange:(fn:any)=>{mocks.listeners.add(fn);return {data:{subscription:{unsubscribe:()=>{mocks.listeners.delete(fn);mocks.unsubscribe();}}}};}}}}));
vi.mock("@/lib/aidp.functions",()=>({listAidpTemplates:mocks.templates,listAidpDocuments:mocks.documents,upsertAidpTemplate:mocks.upsert,deleteAidpTemplate:mocks.remove,createAidpDocument:mocks.create,approveAidpDocument:mocks.approve}));
vi.mock("@/lib/data-sources.functions",()=>({listDataSourcesPage:mocks.sources,getDataSource:mocks.details,createDataSource:vi.fn(),deleteDataSource:vi.fn(),registerUpload:vi.fn(),updateDataSource:vi.fn()}));
vi.mock("@/lib/resource-actor-summaries.functions",()=>({getResourceActorSummaries:mocks.actors}));
vi.mock("@/components/aidp/extraction-audit-timeline",()=>({ExtractionAuditTimeline:()=>null}));
vi.mock("@/components/typed-resource-access-editor",()=>({TypedResourceAccessEditor:()=> <div>Admin mapping editor</div>}));
vi.mock("@/components/confirm-dialog",()=>({useConfirm:()=>({confirm:vi.fn(),ConfirmDialog:null})}));
vi.mock("@/hooks/use-access",()=>({useAccess:()=>({tenantRole:"tenant_viewer",has:()=>false,hasAny:()=>false})}));
vi.mock("sonner",()=>({toast:{success:vi.fn()}}));
import { AidpTab } from "@/components/aidp-tab";
import { DataSourcesTab } from "@/components/data-sources-tab";
const tenant="11111111-1111-4111-8111-111111111111",docId="22222222-2222-4222-8222-222222222222",templateId="33333333-3333-4333-8333-333333333333";
const template={id:templateId,name:"Owned QA template",doc_kind:"generic",sample_prompt:"QA prompt",created_at:"2026-10-04T00:00:00Z"};
const document={id:docId,original_filename:"owned-qa.pdf",bytes:1024,status:"review",mime:"application/pdf",created_at:"2026-10-04T00:00:00Z",template:{name:template.name},confidence:0.9,cost_usd:0};
const mapping=(type:string,id:string,bu:string,group:string)=>({resource_type:type,resource_id:id,public_id:"QA-"+type,access_state:"mapped",business_unit_names:[bu],business_unit_count:1,user_group_names:[group],user_group_count:1});
function mount(ui:ReactNode){const qc=new QueryClient({defaultOptions:{queries:{retry:false}}});const view=render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);return {...view,qc};}
const aidp=(tenantId=tenant)=><AidpTab tenantId={tenantId} tenantSlug="owned-qa" canWrite={false} canManageAccess={false}/>;
async function identity(event:string,userId:string|null){await act(async()=>{for(const listener of mocks.listeners)listener(event,userId?{user:{id:userId}}:null);});}
beforeEach(()=>{vi.resetAllMocks();mocks.listeners.clear();mocks.session.mockResolvedValue({data:{session:{user:{id:"ordinary-viewer"}}},error:null});mocks.templates.mockResolvedValue({rows:[template],total:1});mocks.documents.mockResolvedValue({rows:[document],total:1});mocks.actors.mockResolvedValue({available:true,rows:[]});mocks.sources.mockResolvedValue({rows:[{id:docId,name:"Owned FILE source",source_type:"csv",status:"ready",row_count:1,inferred_schema:[],created_at:document.created_at,updated_at:document.created_at}],total:1,total_pages:1,page:1,page_size:25});mocks.details.mockResolvedValue({id:docId,name:"Owned FILE source",uploads:[],inferred_schema:[]});mocks.summary.mockImplementation(({data})=>Promise.resolve({available:true,rows:data.resource_ids.map((id:string)=>mapping(data.resource_type,id,data.resource_type==="aidp_document"?"Document BU":"Template BU",data.resource_type==="aidp_document"?"Document User_View":"Template User_View"))}));});
afterEach(()=>cleanup());
describe("resumed actual ingestion mapping source-list integration",()=>{
  it("actual patched FILE page consumes actor-scoped summary without broadening ordinary controls",async()=>{
    mount(<DataSourcesTab tenantId={tenant} canWrite={false}/>);await screen.findByText("Template User_View");
    expect(screen.queryByRole("button",{name:"New data source"})).toBeNull();expect(screen.queryByText("Admin mapping editor")).toBeNull();
    expect(screen.getByRole("button",{name:"View Owned FILE source"}).className).toContain("fvi-row-view-action");
  });
  it("actual AIDP document/template rows display separate exact owner/group mappings",async()=>{
    mount(aidp());await screen.findByText("Document User_View");await screen.findByText("Template User_View");
    expect(screen.getByText("Document BU")).toBeTruthy();expect(screen.getByText("Template BU")).toBeTruthy();
    const calls=mocks.summary.mock.calls.map(([input])=>input.data);expect(calls).toContainEqual({resource_type:"aidp_document",resource_ids:[docId]});expect(calls).toContainEqual({resource_type:"aidp_template",resource_ids:[templateId]});
    expect(mocks.create).not.toHaveBeenCalled();expect(mocks.approve).not.toHaveBeenCalled();expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("ordinary document detail retains names and selected-row/gold styling without admin or approve controls",async()=>{
    mount(aidp());await screen.findByText("Document User_View");const row=screen.getByText("owned-qa.pdf").closest("tr")!;
    const view=within(row).getByRole("button",{name:"View detail"});expect(view.className).toContain("fvi-row-view-action");fireEvent.click(view);
    const dialog=await screen.findByRole("dialog");expect(within(dialog).getByText("Document User_View")).toBeTruthy();expect(within(dialog).getByText("Document BU")).toBeTruthy();
    expect(row.className).toContain("fvi-selected-row");expect(screen.queryByText("Admin mapping editor")).toBeNull();expect(screen.queryByRole("button",{name:/Approve/})).toBeNull();
  });
  it("ordinary template detail preserves its scoped names and does not enable mapping editor",async()=>{
    mount(aidp());await screen.findByText("Template User_View");const row=screen.getByText("Owned QA template").closest("tr")!;fireEvent.click(within(row).getByRole("button",{name:"View detail"}));
    const dialog=await screen.findByRole("dialog");expect(within(dialog).getByText("Template User_View")).toBeTruthy();expect(within(dialog).getByText("Template BU")).toBeTruthy();expect(within(dialog).queryByText("Document User_View")).toBeNull();expect(screen.queryByText("Admin mapping editor")).toBeNull();
  });
  it("omitted AIDP document mapping never borrows the visible template's names or claims Unassigned",async()=>{
    mocks.summary.mockImplementation(({data})=>Promise.resolve(data.resource_type==="aidp_document"?{available:true,rows:[]}:{available:true,rows:[mapping("aidp_template",templateId,"Template BU","Template User_View")]}));
    mount(aidp());await screen.findByText("Template User_View");const row=screen.getByText("owned-qa.pdf").closest("tr")!;
    expect(within(row).getAllByText("Access mapping unavailable").length).toBeGreaterThan(0);expect(within(row).queryByText("Template User_View")).toBeNull();expect(within(row).queryByText("Unassigned")).toBeNull();
  });
  it("document refresh failure removes its prior mapping while successful template mapping remains",async()=>{
    const {qc}=mount(aidp());await screen.findByText("Document User_View");await screen.findByText("Template User_View");mocks.summary.mockImplementation(({data})=>data.resource_type==="aidp_document"?Promise.reject(new Error("Read unavailable")):Promise.resolve({available:true,rows:[mapping("aidp_template",templateId,"Template BU","Template User_View")]}));
    await act(async()=>{await qc.invalidateQueries({queryKey:["resource-access-summary",tenant,"aidp_document"]});});
    await waitFor(()=>expect(screen.queryByText("Document User_View")).toBeNull());expect(screen.getByText("Template User_View")).toBeTruthy();
  });
  it("same IDs cannot reuse prior actor AIDP metadata after sign-out/sign-in",async()=>{
    mount(aidp());await screen.findByText("Document User_View");await screen.findByText("Template User_View");await identity("SIGNED_OUT",null);expect(screen.queryByText("Document User_View")).toBeNull();expect(screen.queryByText("Template User_View")).toBeNull();
    mocks.summary.mockResolvedValue({available:true,rows:[]});await identity("SIGNED_IN","ungranted-actor");await waitFor(()=>expect(mocks.summary).toHaveBeenCalledTimes(4));expect(screen.queryByText("Document User_View")).toBeNull();expect(screen.queryByText("Template User_View")).toBeNull();
  });
  it("tenant switch with identical visible IDs cannot reuse prior tenant names",async()=>{
    const {rerender,qc}=mount(aidp());await screen.findByText("Document User_View");await screen.findByText("Template User_View");mocks.summary.mockResolvedValue({available:true,rows:[]});
    rerender(<QueryClientProvider client={qc}>{aidp("44444444-4444-4444-8444-444444444444")}</QueryClientProvider>);
    await waitFor(()=>expect(mocks.summary).toHaveBeenCalledTimes(4));expect(screen.queryByText("Document User_View")).toBeNull();expect(screen.queryByText("Template User_View")).toBeNull();
  });
});
