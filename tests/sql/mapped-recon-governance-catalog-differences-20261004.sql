-- Only newly confirmed actual catalog differences; accepted69 not replayed.
\set tenant '11111111-1111-1111-1111-111111111111'
\set parent '44444444-4444-4444-4444-444444444441'
\set checker '22222222-2222-2222-2222-222222222222'
\set analyst '22222222-2222-2222-2222-222222222223'
CREATE FUNCTION qa.probe_bound_mapped_run(_definition uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE d public.recon_definitions%ROWTYPE; r public.recon_runs%ROWTYPE;
BEGIN
 SELECT * INTO d FROM public.recon_definitions WHERE id=_definition;
 r.id:=gen_random_uuid();r.definition_id:=d.id;r.tenant_id:=d.tenant_id;r.run_by:=auth.uid();
 r:=private.mapped_recon_governance_run(r);RETURN r.run_by;
END $$;
UPDATE qa.session SET actor=:'checker',aal='aal2';
SET ROLE authenticated;
SELECT qa.expect_error('current independent-runner contract retained in narrow helper',format('SELECT qa.probe_bound_mapped_run(%L)',:'parent'),'42501','Independent run actor required');
SELECT qa.expect_error('current approval guard rejects approving checker run',format('INSERT INTO public.recon_runs(definition_id,tenant_id,run_by) VALUES(%L,%L,%L)',:'parent',:'tenant',:'checker'),'42501','Independent run actor required');
RESET ROLE;
UPDATE qa.session SET actor=:'analyst';
SET ROLE authenticated;
INSERT INTO public.recon_runs(definition_id,tenant_id,run_by) VALUES(:'parent',:'tenant',:'analyst');
SELECT qa.assert('actual run guard binds latest approved revision',(SELECT approved_revision_number=3 AND approved_revision_sha256 IS NOT NULL AND approved_revision_id IS NOT NULL FROM public.recon_runs WHERE approved_revision_id IS NOT NULL ORDER BY id LIMIT 1));
SELECT public.request_recon_definition_edit(:'tenant',:'parent','actual trigger qualification correction') AS current_edit \gset
RESET ROLE;
UPDATE qa.session SET actor=:'checker';
SET ROLE authenticated;
SELECT public.decide_recon_definition_edit(:'current_edit',true,'actual native mapped copy') AS current_stage \gset
RESET ROLE;
SELECT qa.assert('native current actor attribution keeps maker and checker distinct',(SELECT created_by=:'analyst' AND created_by_actor_id=:'checker' AND created_by_actor_status='authenticated_user' FROM public.recon_definitions WHERE id=:'current_stage'));
SELECT qa.assert('native reconciliation code allocated on mapped staging',(SELECT recon_code ~ '^FVI-GEN-2WAY-[0-9]{6}$' FROM public.recon_definitions WHERE id=:'current_stage'));
SELECT qa.assert('native audit chain keeps actual checker attribution',(SELECT actor_user_id=:'checker' AND row_hash IS NOT NULL FROM public.audit_log WHERE resource_id=:'current_edit' AND action='recon.definition.edit_approved'));
UPDATE qa.session SET actor=:'analyst';
SET ROLE authenticated;
UPDATE public.recon_definitions SET rules='[{"actual_catalog":"qualified"}]' WHERE id=:'current_stage';
SELECT public.submit_recon_definition_promotion(:'tenant',:'current_stage','native source qualification promotion') AS current_promotion \gset
RESET ROLE;
UPDATE qa.session SET actor=:'checker';
SET ROLE authenticated;
SELECT qa.assert('mapped promotion works with current retirement and provenance guards',public.decide_recon_definition_promotion(:'current_promotion',true,'independent current native approval')=4);
RESET ROLE;
SELECT qa.assert('current actor trigger records actual updating checker',(SELECT created_by=:'analyst' AND created_by_actor_id=:'checker' AND updated_by_actor_id=:'checker' AND governance_state='promoted' FROM public.recon_definitions WHERE id=:'current_stage'));
UPDATE qa.session SET actor=:'analyst',aal='aal1';
SET ROLE authenticated;
SELECT qa.expect_error('current tenant MFA-required policy retained',format('SELECT qa.probe_bound_mapped_run(%L)',:'parent'),'PT409','recon_governance.mfa_assurance_required');
RESET ROLE;
UPDATE qa.session SET aal='aal2';
SET ROLE authenticated;
INSERT INTO public.recon_runs(definition_id,tenant_id,run_by) VALUES(:'parent',:'tenant',:'analyst');
RESET ROLE;
SELECT qa.assert('corrected version4 rerun bound to current immutable revision',(SELECT count(*)=1 FROM public.recon_runs WHERE approved_revision_number=4));
SELECT qa.assert('current audit chain head matches final attributed event',(SELECT h.last_hash=a.row_hash FROM public.audit_chain_head h JOIN public.audit_log a ON a.id=h.last_audit_id WHERE h.singleton));
