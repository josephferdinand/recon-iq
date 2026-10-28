// Rendered source interaction only; no browser/deployment or real issuer claim.
// @vitest-environment jsdom
import React from 'react';
import {describe,it,expect,vi,beforeEach,afterEach} from 'vitest';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
const mocks=vi.hoisted(()=>({create:vi.fn(),invalidate:vi.fn()}));
vi.mock('@tanstack/react-start',()=>({useServerFn:(fn:unknown)=>fn}));
vi.mock('@tanstack/react-query',()=>({
 useQuery:()=>({data:[]}),useQueryClient:()=>({invalidateQueries:mocks.invalidate}),
 useMutation:(options:any)=>({isPending:false,mutate:(value:any)=>Promise.resolve(options.mutationFn(value)).then(options.onSuccess,options.onError)}),
}));
vi.mock('@/lib/gtm.functions',()=>({
 listApiTokens:vi.fn(),createApiToken:mocks.create,revokeApiToken:vi.fn(),listMigrationImports:vi.fn(),startMigrationImport:vi.fn(),
 listSyntheticJobs:vi.fn(),createSyntheticJob:vi.fn(),listChatOps:vi.fn(),upsertChatOps:vi.fn(),
}));
vi.mock('@/components/token-principal-classification-panel',()=>({TokenPrincipalClassificationPanel:()=> <div data-testid="preserved-classification-panel">Existing classification workflow</div>}));
import {GtmTab} from '@/components/gtm-tab';
import {API_TOKEN_SCOPE_IDS} from '@/lib/api-token-scopes';
const tenant='aa000000-0000-4000-8000-000000000002';
beforeEach(()=>{vi.clearAllMocks();mocks.create.mockResolvedValue({id:'aa000000-0000-4000-8000-000000000003',token:'synthetic-unit-only',prefix:'synthetic'});});
afterEach(cleanup);
async function open(){render(<GtmTab tenantId={tenant} canWrite/>);fireEvent.click(screen.getByRole('button',{name:'New token'}));return screen.findByRole('dialog');}
describe('bounded GTM scopes source integration',()=>{
 it('renders supported native checkbox choices, default recons.read and bounded scrolling',async()=>{
  await open();const checkboxes=screen.getAllByRole('checkbox');
  expect(checkboxes).toHaveLength(API_TOKEN_SCOPE_IDS.length);
  const read=screen.getByRole('checkbox',{name:/^recons\.read/}) as HTMLInputElement;
  expect(read.checked).toBe(true);expect(read.closest('fieldset')?.className).toContain('overflow-y-auto');
  expect(screen.queryByText('recon.read')).toBeNull();expect(screen.queryByText('agent.invoke')).toBeNull();
 });
 it('selects AI alongside the valid read scope and passes exact choices to the normal issuer',async()=>{
  await open();fireEvent.change(screen.getAllByRole('textbox')[0],{target:{value:'Owned source integration'}});
  fireEvent.click(screen.getByRole('checkbox',{name:/^ai\.inference/}));
  fireEvent.click(screen.getByRole('button',{name:'Create token'}));
  await waitFor(()=>expect(mocks.create).toHaveBeenCalledWith({data:{tenant_id:tenant,name:'Owned source integration',scopes:['recons.read','ai.inference'],expires_in_days:90}}));
 });
 it('keeps scope selection unavailable to non-writers without minting anything',()=>{
  render(<GtmTab tenantId={tenant} canWrite={false}/>);
  expect(screen.queryByRole('button',{name:'New token'})).toBeNull();
  expect(mocks.create).not.toHaveBeenCalled();
 });
});
