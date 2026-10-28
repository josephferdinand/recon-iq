-- Run only against the retained own native fixture. Newly added cases only.
\set tenant '11111111-1111-1111-1111-111111111111'
\set parent '44444444-4444-4444-4444-444444444441'
\set checker '22222222-2222-2222-2222-222222222222'
\set analyst '22222222-2222-2222-2222-222222222223'
\set group '55555555-5555-5555-5555-555555555551'
INSERT INTO public.tenant_groups VALUES(:'group',:'tenant','33333333-3333-3333-3333-333333333331');
INSERT INTO public.bu_group_assignments VALUES(:'tenant','33333333-3333-3333-3333-333333333331',:'group',true);
INSERT INTO public.tenant_group_members VALUES(:'group',:'analyst');
INSERT INTO public.recon_definition_bu_grants(tenant_id,recon_id,bu_id,principal_type,principal_id,action,granted_by)
 SELECT :'tenant',:'parent',bu_id,'group',:'group','edit',:'checker' FROM public.recon_definition_business_units WHERE recon_id=:'parent';
DELETE FROM public.recon_definition_bu_grants WHERE recon_id=:'parent' AND principal_type='user' AND action='edit';
UPDATE qa.session SET actor=:'analyst';
SET ROLE authenticated;
SELECT public.request_recon_definition_edit(:'tenant',:'parent','group-only current scope') AS group_edit \gset
SELECT qa.expect_error('caller marker cannot replace private transaction receipt',format('SELECT set_config(%L,%L,true); UPDATE public.recon_definitions SET governance_state=%L WHERE id=%L','fvi.recon_governance_request_id',:'group_edit','approved_locked',:'parent'),'PT409','recon_governance.native_workflow_receipt_required');
SELECT qa.expect_error('caller cannot invoke private staging guard directly',format('SELECT private.mapped_recon_governance_stage_insert(d) FROM public.recon_definitions d WHERE id=%L',:'parent'),'42501');
RESET ROLE;
UPDATE qa.session SET actor=:'checker';
BEGIN;
DELETE FROM public.tenant_group_members WHERE group_id=:'group' AND user_id=:'analyst';
SET LOCAL ROLE authenticated;
SELECT qa.expect_error('group membership revocation defeats current requester',format('SELECT public.decide_recon_definition_edit(%L,true,%L)',:'group_edit','group member removed'),'PT409','recon_governance.requester_scope_revoked');
RESET ROLE;ROLLBACK;
BEGIN;
DELETE FROM public.bu_group_assignments WHERE group_id=:'group';
SET LOCAL ROLE authenticated;
SELECT qa.expect_error('group BU association revocation defeats current requester',format('SELECT public.decide_recon_definition_edit(%L,true,%L)',:'group_edit','group BU removed'),'PT409','recon_governance.requester_scope_revoked');
RESET ROLE;ROLLBACK;
BEGIN;
UPDATE public.tenant_groups SET tenant_id='11111111-1111-1111-1111-111111111112' WHERE id=:'group';
SET LOCAL ROLE authenticated;
SELECT qa.expect_error('cross-tenant group cannot carry scope',format('SELECT public.decide_recon_definition_edit(%L,true,%L)',:'group_edit','cross tenant group'),'PT409','recon_governance.requester_scope_revoked');
RESET ROLE;ROLLBACK;
BEGIN;
-- Fixture fault injection of a newer immutable evidence version. This is
-- NOT an authorized product approval or a production row operation.
INSERT INTO public.recon_definition_approved_versions(tenant_id,parent_definition_id,version_number,snapshot,snapshot_sha256,request_id,approved_by)
 SELECT tenant_id,parent_definition_id,3,snapshot,snapshot_sha256,:'group_edit',approved_by FROM public.recon_definition_approved_versions WHERE version_number=2;
SET LOCAL ROLE authenticated;
SELECT qa.expect_error('newer approved evidence makes request stale',format('SELECT public.decide_recon_definition_edit(%L,true,%L)',:'group_edit','stale approved version'),'PT409','recon_governance.frozen_parent_changed');
RESET ROLE;ROLLBACK;

CREATE TABLE qa.audit_fault(enabled boolean);
INSERT INTO qa.audit_fault VALUES(true);
CREATE FUNCTION qa.inject_audit_failure() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN IF (SELECT enabled FROM qa.audit_fault) THEN RAISE EXCEPTION 'native fixture audit storage failure' USING ERRCODE='P0001'; END IF; RETURN NEW; END $$;
CREATE TRIGGER qa_audit_storage_fault BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION qa.inject_audit_failure();
CREATE TABLE qa.before_fault AS SELECT (SELECT count(*) FROM public.recon_definitions) AS definitions,(SELECT count(*) FROM public.recon_definition_governance_audit) AS audits,(SELECT count(*) FROM private.mapped_recon_governance_transitions) AS transitions;
SET ROLE authenticated;
SELECT qa.expect_error('audit error aborts all stage creation and decision writes',format('SELECT public.decide_recon_definition_edit(%L,true,%L)',:'group_edit','fault probe'),'P0001','native fixture audit storage failure');
RESET ROLE;
SELECT qa.assert('audit failure preserves pending request',(SELECT status='pending' AND staging_definition_id IS NULL AND decided_by IS NULL FROM public.recon_definition_governance_requests WHERE id=:'group_edit'));
SELECT qa.assert('audit failure leaves no partial stage or governance audit',
 (SELECT definitions=(SELECT count(*) FROM public.recon_definitions) AND audits=(SELECT count(*) FROM public.recon_definition_governance_audit) AND transitions=(SELECT count(*) FROM private.mapped_recon_governance_transitions) FROM qa.before_fault));
UPDATE qa.audit_fault SET enabled=false;
SET ROLE authenticated;
SELECT public.decide_recon_definition_edit(:'group_edit',true,'independent group-scoped edit') AS group_stage \gset
RESET ROLE;
SELECT qa.assert('new staging templates and exact scope copied',(SELECT s.starter_template_id IS NOT DISTINCT FROM p.starter_template_id AND s.starter_template_snapshot IS NOT DISTINCT FROM p.starter_template_snapshot AND s.tenant_template_id IS NOT DISTINCT FROM p.tenant_template_id AND private.mapped_recon_governance_scope_shape(s.tenant_id,s.id)=private.mapped_recon_governance_scope_shape(p.tenant_id,p.id) FROM public.recon_definitions s JOIN public.recon_definitions p ON p.id=s.governance_parent_id WHERE s.id=:'group_stage'));
UPDATE qa.session SET actor=:'analyst';
SET ROLE authenticated;
UPDATE public.recon_definitions SET rules='[{"group_scope":"correction"}]' WHERE id=:'group_stage';
SELECT qa.assert('current group-only maker can edit mapped stage',(SELECT rules='[{"group_scope":"correction"}]' FROM public.recon_definitions WHERE id=:'group_stage'));
SELECT public.submit_recon_definition_promotion(:'tenant',:'group_stage','freeze group correction') AS group_promotion \gset
RESET ROLE;
UPDATE qa.session SET actor=:'checker';
BEGIN;
INSERT INTO public.recon_definition_bu_grants(tenant_id,recon_id,bu_id,principal_type,principal_id,action,granted_by)
 VALUES(:'tenant',:'parent','33333333-3333-3333-3333-333333333331','group',:'group','view',:'checker');
SET LOCAL ROLE authenticated;
SELECT qa.expect_error('parent grant revision prevents stale promotion',format('SELECT public.decide_recon_definition_promotion(%L,true,%L)',:'group_promotion','changed parent grants'),'PT409','recon_governance.frozen_config_or_mapping_changed');
RESET ROLE;ROLLBACK;
SET ROLE authenticated;
SELECT qa.assert('independent rejection returns no approved version',public.decide_recon_definition_promotion(:'group_promotion',false,'reject correction') IS NULL);
RESET ROLE;
SELECT qa.assert('rejected mapped stage remains editable',(SELECT access_mode='mapped_exact' AND governance_state='staging_copy' FROM public.recon_definitions WHERE id=:'group_stage'));
SELECT qa.assert('rejection does not fabricate version3',(SELECT count(*)=2 FROM public.recon_definition_approved_versions));
SELECT json_build_object('durable_passed',count(*),'failed',count(*) FILTER(WHERE NOT passed)) FROM qa.results;
