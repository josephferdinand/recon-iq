\set tenant '11111111-1111-1111-1111-111111111111'
\set parent '44444444-4444-4444-4444-444444444441'
\set checker '22222222-2222-2222-2222-222222222222'
\set analyst '22222222-2222-2222-2222-222222222223'
SELECT staging_definition_id AS stage,id AS edit_request FROM public.recon_definition_governance_requests WHERE parent_definition_id=:'parent' AND request_kind='edit' AND status='approved' ORDER BY created_at DESC LIMIT 1 \gset
SELECT qa.assert('current direct and group scope still validates',private.mapped_recon_governance_mapping(:'tenant',:'parent')->>'access_mode'='mapped_exact');
UPDATE qa.session SET actor=:'analyst';
SET ROLE authenticated;
SELECT qa.expect_error('caller cannot forge private transition evidence',format('INSERT INTO private.mapped_recon_governance_transitions(request_id,actor_id,purpose) VALUES(%L,%L,%L)',:'edit_request',:'analyst','edit_decision'),'42501');
RESET ROLE;
BEGIN;
INSERT INTO public.recon_definition_bu_grants(tenant_id,recon_id,bu_id,principal_type,principal_id,action,granted_by)
 VALUES(:'tenant',:'parent','33333333-3333-3333-3333-333333333331','user',:'checker','view',:'checker');
SET LOCAL ROLE authenticated;
SELECT qa.expect_error('unused direct grant cannot copy without current BU association',format('SELECT public.submit_recon_definition_promotion(%L,%L,%L)',:'tenant',:'stage','invalid user scope'),'PT409','recon_governance.grant_scope_inactive_or_cross_tenant');
RESET ROLE;ROLLBACK;
BEGIN;
INSERT INTO public.tenant_groups VALUES('55555555-5555-5555-5555-555555555552',:'tenant','33333333-3333-3333-3333-333333333331');
INSERT INTO public.recon_definition_bu_grants(tenant_id,recon_id,bu_id,principal_type,principal_id,action,granted_by)
 VALUES(:'tenant',:'parent','33333333-3333-3333-3333-333333333331','group','55555555-5555-5555-5555-555555555552','view',:'checker');
SET LOCAL ROLE authenticated;
SELECT qa.expect_error('unused group grant cannot copy without current BU association',format('SELECT public.submit_recon_definition_promotion(%L,%L,%L)',:'tenant',:'stage','invalid group scope'),'PT409','recon_governance.grant_scope_inactive_or_cross_tenant');
RESET ROLE;ROLLBACK;
SELECT qa.assert('scope-validation refusals create no promotion request',(SELECT count(*)=0 FROM public.recon_definition_governance_requests WHERE staging_definition_id=:'stage' AND status='pending'));
SELECT qa.assert('scope-validation refusals keep mapped stage editable',(SELECT access_mode='mapped_exact' AND governance_state='staging_copy' FROM public.recon_definitions WHERE id=:'stage'));
