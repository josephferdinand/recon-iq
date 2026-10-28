\set tenant '11111111-1111-1111-1111-111111111111'
\set parent '44444444-4444-4444-4444-444444444441'
\set checker '22222222-2222-2222-2222-222222222222'
\set analyst '22222222-2222-2222-2222-222222222223'
SELECT staging_definition_id AS stage FROM public.recon_definition_governance_requests WHERE parent_definition_id=:'parent' AND request_kind='edit' AND status='approved' ORDER BY created_at DESC LIMIT 1 \gset
SELECT id AS rejected_request FROM public.recon_definition_governance_requests WHERE parent_definition_id=:'parent' AND request_kind='promotion' AND status='rejected' ORDER BY created_at DESC LIMIT 1 \gset
UPDATE qa.session SET actor=:'analyst';
BEGIN;
-- Fault injection only: correct config/hash but no approved request or version
-- audit binding. Rejected requests must never become approval evidence.
INSERT INTO public.recon_definition_approved_versions(tenant_id,parent_definition_id,version_number,snapshot,snapshot_sha256,request_id,approved_by)
 SELECT tenant_id,parent_definition_id,3,snapshot,snapshot_sha256,:'rejected_request',approved_by FROM public.recon_definition_approved_versions WHERE version_number=2;
SET LOCAL ROLE authenticated;
SELECT qa.expect_error('unapproved version artifact cannot authorize promotion',format('SELECT public.submit_recon_definition_promotion(%L,%L,%L)',:'tenant',:'stage','unapproved artifact'),'PT409','recon_governance.parent_version_evidence_required');
RESET ROLE;ROLLBACK;
SET ROLE authenticated;
SELECT public.submit_recon_definition_promotion(:'tenant',:'stage','approve current group correction') AS qualified_promotion \gset
RESET ROLE;
UPDATE qa.session SET actor=:'checker';
SET ROLE authenticated;
SELECT qa.assert('qualified independent group correction becomes version3',public.decide_recon_definition_promotion(:'qualified_promotion',true,'real native independent approval')=3);
RESET ROLE;
SELECT qa.assert('version3 request and audit bound snapshot immutable',(SELECT v.snapshot=private.recon_definition_config_snapshot(d) AND v.snapshot_sha256=q.snapshot_sha256 AND v.approved_by=q.decided_by AND a.snapshot_sha256=v.snapshot_sha256 AND a.actor_id=v.approved_by FROM public.recon_definition_approved_versions v JOIN public.recon_definitions d ON d.id=v.parent_definition_id JOIN public.recon_definition_governance_requests q ON q.id=v.request_id JOIN public.recon_definition_governance_audit a ON a.request_id=q.id AND a.event_type='version_approved' WHERE v.version_number=3));
UPDATE qa.session SET actor=:'analyst';
SET ROLE authenticated;
INSERT INTO public.recon_runs(definition_id,tenant_id,run_by) VALUES(:'parent',:'tenant',:'analyst');
SELECT qa.assert('group correction rerun retains both previous runs',(SELECT count(*)=3 FROM public.recon_runs));
RESET ROLE;
BEGIN;
INSERT INTO public.recon_definition_approved_versions(tenant_id,parent_definition_id,version_number,snapshot,snapshot_sha256,request_id,approved_by)
 SELECT tenant_id,parent_definition_id,4,snapshot,snapshot_sha256,:'rejected_request',approved_by FROM public.recon_definition_approved_versions WHERE version_number=3;
SET LOCAL ROLE authenticated;
SELECT qa.expect_error('unapproved version artifact cannot authorize edit request',format('SELECT public.request_recon_definition_edit(%L,%L,%L)',:'tenant',:'parent','unapproved edit artifact'),'PT409','recon_governance.approved_version_evidence_required');
RESET ROLE;ROLLBACK;
SET ROLE authenticated;
SELECT public.request_recon_definition_edit(:'tenant',:'parent','edit from qualified native version3') AS qualified_edit \gset
SELECT qa.assert('new edit freezes current approved version3',(SELECT source_version=3 FROM public.recon_definition_governance_requests WHERE id=:'qualified_edit'));
RESET ROLE;
UPDATE qa.session SET actor=:'checker';
SET ROLE authenticated;
SELECT public.decide_recon_definition_edit(:'qualified_edit',false,'independent native rejection');
RESET ROLE;
SELECT qa.assert('old versions and approval history retained',(SELECT count(*)=3 FROM public.recon_definition_approved_versions) AND (SELECT snapshot->'rules'='[]' FROM public.recon_definition_approved_versions WHERE version_number=1) AND (SELECT governance_state='approved_locked' AND access_mode='mapped_exact' FROM public.recon_definitions WHERE id=:'parent'));
