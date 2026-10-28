\set tenant '11111111-1111-1111-1111-111111111111'
\set parent '44444444-4444-4444-4444-444444444441'
\set adminmaker '22222222-2222-2222-2222-222222222221'
\set checker '22222222-2222-2222-2222-222222222222'
\set analyst '22222222-2222-2222-2222-222222222223'
\set outsider '22222222-2222-2222-2222-222222222224'
CREATE TABLE qa.scope_before AS SELECT private.mapped_recon_governance_scope_shape(:'tenant',:'parent') AS shape;
SET ROLE authenticated;
SELECT public.submit_recon_definition_promotion(:'tenant',:'parent','initial mapped production approval') AS initial_request \gset
SELECT qa.expect_error('initial self approval is PT409',format('SELECT public.decide_recon_definition_promotion(%L,true,%L)',:'initial_request','self'),'PT409','recon_governance.independent_checker_required');
RESET ROLE;
UPDATE qa.session SET actor=:'checker',aal='aal1';
SET ROLE authenticated;
SELECT qa.expect_error('checker MFA policy enforced',format('SELECT public.decide_recon_definition_promotion(%L,true,%L)',:'initial_request','low assurance'),'PT409','recon_governance.mfa_assurance_required');
RESET ROLE;
UPDATE qa.session SET aal='aal2';
SET ROLE authenticated;
SELECT qa.assert('first immutable approved version',public.decide_recon_definition_promotion(:'initial_request',true,'independent approve')=1);
SELECT qa.expect_error('decision replay denied',format('SELECT public.decide_recon_definition_promotion(%L,true,%L)',:'initial_request','replay'),'PT409','recon_governance.request_stale_or_replayed');
SELECT qa.expect_error('locked parent direct edit denied',format('UPDATE public.recon_definitions SET name=%L WHERE id=%L','unsafe',:'parent'),'PT409','recon_governance.native_workflow_receipt_required');
RESET ROLE;
SELECT qa.assert('initial promotion preserves exact grants and BU owners',(SELECT shape FROM qa.scope_before)=private.mapped_recon_governance_scope_shape(:'tenant',:'parent'));
SELECT qa.assert('approved mapping frozen',(SELECT approved_mapping_fingerprint=private.mapped_recon_governance_hash(approved_mapping_snapshot) FROM public.recon_definition_approved_versions WHERE version_number=1));
UPDATE qa.session SET actor=:'analyst';
SET ROLE authenticated;
INSERT INTO public.recon_runs(definition_id,tenant_id,run_by) VALUES(:'parent',:'tenant',:'analyst');
SELECT qa.assert('scoped analyst production run allowed',(SELECT count(*)=1 FROM public.recon_runs));
SELECT public.request_recon_definition_edit(:'tenant',:'parent','scoped analyst corrected rule') AS edit_request \gset
SELECT qa.assert('requester sees own request under RLS',(SELECT count(*)=1 FROM public.recon_definition_governance_requests WHERE id=:'edit_request'));
SELECT qa.expect_error('analyst cannot decide without tenant-admin authority',format('SELECT public.decide_recon_definition_edit(%L,true,%L)',:'edit_request','analyst checker'),'PT409','recon_governance.current_checker_authority_required');
RESET ROLE;
UPDATE qa.session SET actor=:'outsider';
SET ROLE authenticated;
SELECT qa.expect_error('cross-tenant checker denied',format('SELECT public.decide_recon_definition_edit(%L,true,%L)',:'edit_request','outside tenant'),'PT409','recon_governance.current_membership_required');
RESET ROLE;
UPDATE qa.session SET actor=:'checker';
-- Current requester revocation must defeat a previously submitted request.
UPDATE public.tenant_members SET active=false WHERE tenant_id=:'tenant' AND user_id=:'analyst';
SET ROLE authenticated;
SELECT qa.expect_error('requester membership revocation checked at decision',format('SELECT public.decide_recon_definition_edit(%L,true,%L)',:'edit_request','revoked requester'),'PT409','recon_governance.requester_scope_revoked');
RESET ROLE;
UPDATE public.tenant_members SET active=true WHERE tenant_id=:'tenant' AND user_id=:'analyst';
UPDATE public.tenant_members SET active=false WHERE tenant_id=:'tenant' AND user_id=:'checker';
SET ROLE authenticated;
SELECT qa.expect_error('checker membership revocation checked at decision',format('SELECT public.decide_recon_definition_edit(%L,true,%L)',:'edit_request','revoked checker'),'PT409','recon_governance.current_membership_required');
RESET ROLE;
UPDATE public.tenant_members SET active=true WHERE tenant_id=:'tenant' AND user_id=:'checker';
SET ROLE authenticated;
SELECT public.decide_recon_definition_edit(:'edit_request',true,'independent edit approve') AS stage \gset
RESET ROLE;
SELECT qa.assert('stage remains mapped with exact parent grant tuples',private.mapped_recon_governance_scope_shape(:'tenant',:'stage')=private.mapped_recon_governance_scope_shape(:'tenant',:'parent'));
SELECT qa.assert('stage current requester edit authorized',private.recon_authoritative_access_decision_as(:'analyst',:'stage','edit'));
SELECT qa.assert('stage identity is real approved edit copy',(SELECT access_mode='mapped_exact' AND multi_bu_governed AND created_by=:'analyst' AND governance_parent_id=:'parent' AND governance_state='staging_copy' FROM public.recon_definitions WHERE id=:'stage'));
UPDATE qa.session SET actor=:'analyst';
SET ROLE authenticated;
UPDATE public.recon_definitions SET rules='[{"rule":"corrected"}]' WHERE id=:'stage';
SELECT qa.assert('scoped analyst can edit mapped staging',(SELECT rules='[{"rule":"corrected"}]' FROM public.recon_definitions WHERE id=:'stage'));
SELECT qa.expect_error('stage cannot downgrade mapping',format('UPDATE public.recon_definitions SET access_mode=%L WHERE id=%L','unmapped_pending',:'stage'),'PT409','recon_governance.native_identity_or_scope_immutable');
SELECT public.submit_recon_definition_promotion(:'tenant',:'stage','promote mapped correction') AS correction_request \gset
SELECT qa.expect_error('frozen staging direct change denied',format('UPDATE public.recon_definitions SET rules=%L::jsonb WHERE id=%L','[]',:'stage'),'PT409','recon_governance.native_workflow_receipt_required');
RESET ROLE;
UPDATE qa.session SET actor=:'checker';
SET ROLE authenticated;
SELECT qa.assert('corrected immutable version approved',public.decide_recon_definition_promotion(:'correction_request',true,'independent corrected promotion')=2);
RESET ROLE;
SELECT qa.assert('promoted parent contains exact approved configuration',(SELECT rules='[{"rule":"corrected"}]' AND governance_state='approved_locked' AND environment='production' AND access_mode='mapped_exact' FROM public.recon_definitions WHERE id=:'parent'));
SELECT qa.assert('staging copy is closed after promotion',(SELECT governance_state='promoted' FROM public.recon_definitions WHERE id=:'stage'));
SELECT qa.assert('version1 historical snapshot unchanged',(SELECT snapshot->'rules'='[]' FROM public.recon_definition_approved_versions WHERE version_number=1));
SELECT qa.assert('successful audit coupled atomically',(SELECT count(*)=8 FROM public.recon_definition_governance_audit) AND (SELECT count(*)=6 FROM public.audit_log));
UPDATE qa.session SET actor=:'analyst';
SET ROLE authenticated;
INSERT INTO public.recon_runs(definition_id,tenant_id,run_by) VALUES(:'parent',:'tenant',:'analyst');
SELECT qa.assert('legitimate corrected parent rerun',(SELECT count(*)=2 FROM public.recon_runs));
SELECT qa.expect_error('caller-selected run actor denied',format('INSERT INTO public.recon_runs(definition_id,tenant_id,run_by) VALUES(%L,%L,%L)',:'parent',:'tenant',:'checker'),'PT409','recon_governance.native_run_actor_or_tenant_mismatch');
RESET ROLE;
SELECT qa.expect_error('approved historical snapshot mutation blocked',format('UPDATE public.recon_definition_approved_versions SET snapshot=%L::jsonb WHERE version_number=1','{}'),'23514');
SELECT qa.expect_error('governance history mutation blocked','DELETE FROM public.recon_definition_governance_audit','23514');

-- Negative changes run in transactions and roll back the real fixture change.
UPDATE qa.session SET actor=:'analyst';
SET ROLE authenticated;
SELECT public.request_recon_definition_edit(:'tenant',:'parent','second exact request') AS pending_edit \gset
RESET ROLE;
UPDATE qa.session SET actor=:'checker';
BEGIN;
UPDATE public.bu_user_assignments SET inherit_descendants=false WHERE user_id=:'analyst';
SET LOCAL ROLE authenticated;
SELECT qa.expect_error('current assignment revision freezes approval',format('SELECT public.decide_recon_definition_edit(%L,true,%L)',:'pending_edit','changed assignment'),'PT409','recon_governance.frozen_parent_changed');
RESET ROLE;
ROLLBACK;
BEGIN;
UPDATE public.business_units SET is_archived=true WHERE id='33333333-3333-3333-3333-333333333332';
SET LOCAL ROLE authenticated;
SELECT qa.expect_error('inactive owner fails current approve authority',format('SELECT public.decide_recon_definition_edit(%L,true,%L)',:'pending_edit','inactive owner'),'PT409','recon_governance.current_approve_authority_required');
RESET ROLE;
ROLLBACK;
BEGIN;
DELETE FROM public.recon_definition_bu_grants WHERE principal_id=:'analyst' AND action='edit';
SET LOCAL ROLE authenticated;
SELECT qa.expect_error('current requester edit grant revocation defeats approval',format('SELECT public.decide_recon_definition_edit(%L,true,%L)',:'pending_edit','grant revoked'),'PT409','recon_governance.requester_scope_revoked');
RESET ROLE;
ROLLBACK;
SELECT qa.expect_error('frozen request evidence cannot mutate',format('UPDATE public.recon_definition_governance_requests SET parent_mapping_fingerprint=%L WHERE id=%L',repeat('0',64),:'pending_edit'),'PT409','recon_governance.native_request_snapshot_immutable');
SET ROLE authenticated;
SELECT public.decide_recon_definition_edit(:'pending_edit',false,'independent reject') AS rejected_stage;
RESET ROLE;
SELECT qa.assert('rejection leaves approved parent usable',(SELECT governance_state='approved_locked' FROM public.recon_definitions WHERE id=:'parent'));
SELECT json_build_object('passed',count(*),'failed',count(*) FILTER(WHERE NOT passed)) FROM qa.results;
