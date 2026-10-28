-- Disposable DB only. Requires reconciliation-authoritative-access-decision-fixture.sql
-- and the existing authoritative-access regression fixture state.
BEGIN;

DO $acl$
DECLARE
  public_proc oid := 'public.recon_authoritative_access_decision_as(uuid,uuid,text)'::regprocedure;
  private_proc oid := 'private.recon_authoritative_access_decision_as(uuid,uuid,text)'::regprocedure;
BEGIN
  IF NOT has_function_privilege('service_role', public_proc, 'EXECUTE')
     OR has_function_privilege('anon', public_proc, 'EXECUTE')
     OR has_function_privilege('authenticated', public_proc, 'EXECUTE') THEN
    RAISE EXCEPTION 'actor-explicit public decision ACL is not service_role-only';
  END IF;
  IF EXISTS (SELECT 1 FROM aclexplode((SELECT proacl FROM pg_proc WHERE oid=public_proc)) a
             WHERE a.grantee=0 AND a.privilege_type='EXECUTE') THEN
    RAISE EXCEPTION 'PUBLIC can execute actor-explicit public decision';
  END IF;
  IF has_function_privilege('service_role', private_proc, 'EXECUTE')
     OR has_function_privilege('anon', private_proc, 'EXECUTE')
     OR has_function_privilege('authenticated', private_proc, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM aclexplode((SELECT proacl FROM pg_proc WHERE oid=private_proc)) a
                WHERE a.grantee=0 AND a.privilege_type='EXECUTE') THEN
    RAISE EXCEPTION 'private actor evaluator is directly executable by a runtime role';
  END IF;
  IF (SELECT proargnames FROM pg_proc WHERE oid=public_proc)
       IS DISTINCT FROM ARRAY['_actor','_recon','_action']::text[] THEN
    RAISE EXCEPTION 'actor-explicit RPC argument contract changed';
  END IF;
END
$acl$;

-- Make only the synthetic definitions mapped for this transaction. The
-- fixture and all changes below roll back together at the end.
ALTER TABLE public.recon_definitions DISABLE TRIGGER recon_definitions_governance_guard;
INSERT INTO public.recon_definition_business_units(tenant_id,recon_id,bu_id)
VALUES ('f4400000-0000-4000-8000-000000000004',
        'f4400000-0000-4000-8000-000000000024',
        'f4400000-0000-4000-8000-000000000044');
UPDATE public.recon_definitions
SET access_mode='mapped_exact', governance_state='approved_locked', multi_bu_governed=true
WHERE id IN ('f4400000-0000-4000-8000-000000000022',
             'f4400000-0000-4000-8000-000000000023',
             'f4400000-0000-4000-8000-000000000024');
UPDATE public.recon_definitions
SET access_mode='unmapped_pending', governance_state='development_draft', environment='development'
WHERE id='f4400000-0000-4000-8000-000000000025';
ALTER TABLE public.recon_definitions ENABLE TRIGGER recon_definitions_governance_guard;

-- Move the run grant from an assigned BU to its sibling to prove sibling BU
-- scope does not leak through the same definition's other owner BU.
DELETE FROM public.recon_definition_bu_grants
WHERE tenant_id='f4400000-0000-4000-8000-000000000003'
  AND recon_id='f4400000-0000-4000-8000-000000000022'
  AND bu_id='f4400000-0000-4000-8000-000000000041'
  AND principal_type='user'
  AND principal_id='f4400000-0000-4000-8000-000000000012'
  AND action='run';
INSERT INTO public.recon_definition_bu_grants(tenant_id,recon_id,bu_id,principal_type,principal_id,action)
VALUES ('f4400000-0000-4000-8000-000000000003',
        'f4400000-0000-4000-8000-000000000022',
        'f4400000-0000-4000-8000-000000000042',
        'user','f4400000-0000-4000-8000-000000000012','run');

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role','service_role',true);
DO $actor_decisions$
BEGIN
  IF public.recon_authoritative_access_decision_as(
       'f4400000-0000-4000-8000-000000000012',
       'f4400000-0000-4000-8000-000000000022','run') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'direct grant on a sibling owner BU bypassed current BU assignment';
  END IF;
  IF public.recon_authoritative_access_decision_as(
       'f4400000-0000-4000-8000-000000000013',
       'f4400000-0000-4000-8000-000000000022','view') IS DISTINCT FROM true
     OR public.recon_authoritative_access_decision_as(
       'f4400000-0000-4000-8000-000000000013',
       'f4400000-0000-4000-8000-000000000022','run') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'group access did not preserve action-specific membership semantics';
  END IF;
  IF public.recon_authoritative_access_decision_as(
       'f4400000-0000-4000-8000-000000000014',
       'f4400000-0000-4000-8000-000000000022','edit') IS DISTINCT FROM false
     OR public.recon_authoritative_access_decision_as(
       'f4400000-0000-4000-8000-000000000015',
       'f4400000-0000-4000-8000-000000000022','edit') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'missing or inactive BU/tenant membership granted direct access';
  END IF;
  IF public.recon_authoritative_access_decision_as(
       'f4400000-0000-4000-8000-000000000011',
       'f4400000-0000-4000-8000-000000000022','approve') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'active same-tenant admin override was denied';
  END IF;
  IF public.recon_authoritative_access_decision_as(
       'f4400000-0000-4000-8000-000000000012',
       'f4400000-0000-4000-8000-000000000024','view') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'mapped cross-tenant actor was allowed';
  END IF;
  IF public.recon_authoritative_access_decision_as(
       'f4400000-0000-4000-8000-000000000013',
       'f4400000-0000-4000-8000-000000000021','run')
       IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'legacy tenant-analyst run parity changed';
  END IF;
  IF public.recon_authoritative_access_decision_as(
       'f4400000-0000-4000-8000-000000000016',
       'f4400000-0000-4000-8000-000000000024','view') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'legacy platform-admin decision changed';
  END IF;
END
$actor_decisions$;

RESET ROLE;
DO $legacy_helper_parity$
BEGIN
  IF public.recon_authoritative_access_decision_as(
       'f4400000-0000-4000-8000-000000000016',
       'f4400000-0000-4000-8000-000000000024','view')
       IS DISTINCT FROM private.user_can_access_recon(
         'f4400000-0000-4000-8000-000000000016',
         'f4400000-0000-4000-8000-000000000024','view') THEN
    RAISE EXCEPTION 'legacy platform-admin parity diverged from existing helper';
  END IF;
END
$legacy_helper_parity$;

-- A service JWT calling the public endpoint cannot elevate itself to another
-- actor when the same RPC is reached by an authenticated client.
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000014',true);
DO $no_client_forgery$
BEGIN
  BEGIN
    PERFORM public.recon_authoritative_access_decision_as(
      'f4400000-0000-4000-8000-000000000011',
      'f4400000-0000-4000-8000-000000000022','approve');
    RAISE EXCEPTION 'authenticated client invoked actor-explicit RPC';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$no_client_forgery$;
RESET ROLE;

-- Retired and archived definitions are denied regardless of actor capability.
ALTER TABLE public.recon_definitions DISABLE TRIGGER recon_definitions_governance_guard;
ALTER TABLE public.recon_definitions DISABLE TRIGGER trg_guard_recon_definition_retirement;
UPDATE public.recon_definitions SET retired_at=now()
WHERE id='f4400000-0000-4000-8000-000000000022';
ALTER TABLE public.recon_definitions ENABLE TRIGGER trg_guard_recon_definition_retirement;
ALTER TABLE public.recon_definitions ENABLE TRIGGER recon_definitions_governance_guard;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role','service_role',true);
DO $retired$
BEGIN
  IF public.recon_authoritative_access_decision_as(
       'f4400000-0000-4000-8000-000000000011',
       'f4400000-0000-4000-8000-000000000022','view') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'retired definition was allowed';
  END IF;
END
$retired$;
RESET ROLE;
ALTER TABLE public.recon_definitions DISABLE TRIGGER recon_definitions_governance_guard;
ALTER TABLE public.recon_definitions DISABLE TRIGGER trg_guard_recon_definition_retirement;
UPDATE public.recon_definitions SET retired_at=NULL, status='archived'
WHERE id='f4400000-0000-4000-8000-000000000022';
ALTER TABLE public.recon_definitions ENABLE TRIGGER trg_guard_recon_definition_retirement;
ALTER TABLE public.recon_definitions ENABLE TRIGGER recon_definitions_governance_guard;
SET LOCAL ROLE service_role;
DO $archived$
BEGIN
  IF public.recon_authoritative_access_decision_as(
       'f4400000-0000-4000-8000-000000000011',
       'f4400000-0000-4000-8000-000000000022','view') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'archived definition was allowed';
  END IF;
END
$archived$;
RESET ROLE;

ROLLBACK;
