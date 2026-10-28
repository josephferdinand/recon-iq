-- Disposable DB only. Tests the additive Phase-2 evaluator; it does not alter
-- live rows, RLS, APIs, workers, or the existing legacy access helper.
BEGIN;

-- The migration deliberately has no public transition to mapped_exact. Bypass
-- only this governance trigger for synthetic cutover fixtures in disposable DB.
ALTER TABLE public.recon_definitions DISABLE TRIGGER recon_definitions_governance_guard;
-- Give the tenant-B fixture definition a real tenant-B owner, then exercise
-- it from a tenant-A actor below. The whole setup is rolled back at the end.
INSERT INTO public.recon_definition_business_units(tenant_id,recon_id,bu_id)
VALUES ('f4400000-0000-4000-8000-000000000004',
        'f4400000-0000-4000-8000-000000000024',
        'f4400000-0000-4000-8000-000000000044');
UPDATE public.recon_definitions
SET access_mode='mapped_exact', governance_state='approved_locked', multi_bu_governed=true
WHERE id IN (
  'f4400000-0000-4000-8000-000000000022',
  'f4400000-0000-4000-8000-000000000023',
  'f4400000-0000-4000-8000-000000000024'
);
UPDATE public.recon_definitions
SET access_mode='unmapped_pending', governance_state='development_draft',
    environment='development'
WHERE id='f4400000-0000-4000-8000-000000000025';
UPDATE public.recon_definitions
SET access_mode='mapped_exact', governance_state='approved_locked'
WHERE id='f4400000-0000-4000-8000-000000000026';
ALTER TABLE public.recon_definitions ENABLE TRIGGER recon_definitions_governance_guard;

-- The function exposes only (reconciliation, action); callers cannot choose an
-- actor. Its public RPC ACL is limited to authenticated users.
DO $acl$
BEGIN
  IF has_function_privilege('authenticated',
       'public.recon_authoritative_access_decision(uuid,text)','EXECUTE') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'authenticated role cannot execute actor-bound access decision';
  END IF;
  IF has_function_privilege('anon',
       'public.recon_authoritative_access_decision(uuid,text)','EXECUTE') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'anonymous role can execute access decision';
  END IF;
  IF (SELECT p.proargnames FROM pg_proc p
      WHERE p.oid='public.recon_authoritative_access_decision(uuid,text)'::regprocedure)
      IS DISTINCT FROM ARRAY['_recon','_action']::text[] THEN
    RAISE EXCEPTION 'access decision unexpectedly exposes an actor argument';
  END IF;
END
$acl$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000012',true);
DO $mapped_direct_group$
BEGIN
  IF public.recon_authoritative_access_decision('f4400000-0000-4000-8000-000000000022','run') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'direct-user run grant on an assigned owning BU was denied';
  END IF;
  IF public.recon_authoritative_access_decision('f4400000-0000-4000-8000-000000000022','view') IS DISTINCT FROM true
     OR public.recon_authoritative_access_decision('f4400000-0000-4000-8000-000000000022','read') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'view grant from direct/group principals did not authorize view/read';
  END IF;
  IF public.recon_authoritative_access_decision('f4400000-0000-4000-8000-000000000022','approve') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'group approve grant did not union with the direct-user grant';
  END IF;
  IF public.recon_authoritative_access_decision('f4400000-0000-4000-8000-000000000022','edit') IS DISTINCT FROM false
     OR public.recon_authoritative_access_decision('f4400000-0000-4000-8000-000000000022','unknown') IS DISTINCT FROM false
     OR public.recon_authoritative_access_decision('f4400000-0000-4000-8000-000000000022',NULL) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'wrong or unsupported action was allowed';
  END IF;
  IF public.recon_authoritative_access_decision('f4400000-0000-4000-8000-000000000026','view') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'mapped definition with no owning BU was allowed';
  END IF;
END
$mapped_direct_group$;

-- BU group grant applies only to active tenant-group members with the group's
-- current owner-BU assignment; a group grant does not imply other actions.
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000013',true);
DO $mapped_group$
BEGIN
  IF public.recon_authoritative_access_decision('f4400000-0000-4000-8000-000000000022','view') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'same-tenant group view grant was denied';
  END IF;
  IF public.recon_authoritative_access_decision('f4400000-0000-4000-8000-000000000022','run') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'group view grant implied run access';
  END IF;
END
$mapped_group$;

-- Direct grant without current BU membership and inactive tenant membership
-- both fail closed; grant existence alone is not capability.
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000014',true);
DO $no_bu$
BEGIN
  IF public.recon_authoritative_access_decision('f4400000-0000-4000-8000-000000000022','edit') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'direct grant without owner-BU membership was allowed';
  END IF;
END
$no_bu$;
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000015',true);
DO $inactive$
BEGIN
  IF public.recon_authoritative_access_decision('f4400000-0000-4000-8000-000000000022','edit') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'inactive tenant member with BU and grant was allowed';
  END IF;
END
$inactive$;

-- Descendant scope follows the assignment's explicit inheritance flag.
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000012',true);
DO $descendant$
BEGIN
  IF public.recon_authoritative_access_decision('f4400000-0000-4000-8000-000000000023','run') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'inherited descendant BU grant was denied';
  END IF;
END
$descendant$;
RESET ROLE;
UPDATE public.bu_user_assignments
SET inherit_descendants=false
WHERE tenant_id='f4400000-0000-4000-8000-000000000003'
  AND bu_id='f4400000-0000-4000-8000-000000000041'
  AND user_id='f4400000-0000-4000-8000-000000000012';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000012',true);
DO $no_descendant$
BEGIN
  IF public.recon_authoritative_access_decision('f4400000-0000-4000-8000-000000000023','run') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'descendant grant ignored disabled inheritance';
  END IF;
END
$no_descendant$;

-- The pre-cutover branch preserves the legacy helper result. It does not model
-- separate policy OR branches (such as creator-read) or child-table policies;
-- those require a later RLS parity review before this evaluator is wired in.
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000013',true);
DO $legacy_analyst$
BEGIN
  IF public.recon_authoritative_access_decision('f4400000-0000-4000-8000-000000000021','run') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'legacy helper tenant-analyst result changed before row cutover';
  END IF;
  IF public.recon_authoritative_access_decision('f4400000-0000-4000-8000-000000000025','view') IS DISTINCT FROM false
     OR public.recon_authoritative_access_decision('f4400000-0000-4000-8000-000000000025','run') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'unmapped non-admin was allowed';
  END IF;
END
$legacy_analyst$;

SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000011',true);
DO $admin$
BEGIN
  IF public.recon_authoritative_access_decision('f4400000-0000-4000-8000-000000000022','approve') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'active in-tenant admin lost mapped capability';
  END IF;
  IF public.recon_authoritative_access_decision('f4400000-0000-4000-8000-000000000025','view') IS DISTINCT FROM true
     OR public.recon_authoritative_access_decision('f4400000-0000-4000-8000-000000000025','edit') IS DISTINCT FROM true
     OR public.recon_authoritative_access_decision('f4400000-0000-4000-8000-000000000025','run') IS DISTINCT FROM true
     OR public.recon_authoritative_access_decision('f4400000-0000-4000-8000-000000000025','approve') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'unmapped development admin capability did not match the safe workflow';
  END IF;
END
$admin$;
RESET ROLE;

ALTER TABLE public.recon_definitions DISABLE TRIGGER recon_definitions_governance_guard;
UPDATE public.recon_definitions SET environment='production'
WHERE id='f4400000-0000-4000-8000-000000000025';
ALTER TABLE public.recon_definitions ENABLE TRIGGER recon_definitions_governance_guard;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000011',true);
DO $admin_production$
BEGIN
  IF public.recon_authoritative_access_decision('f4400000-0000-4000-8000-000000000025','view') IS DISTINCT FROM true
     OR public.recon_authoritative_access_decision('f4400000-0000-4000-8000-000000000025','edit') IS DISTINCT FROM false
     OR public.recon_authoritative_access_decision('f4400000-0000-4000-8000-000000000025','run') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'unmapped production admin access exceeded mapping/setup read';
  END IF;
END
$admin_production$;

SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000016',true);
DO $platform_only$
BEGIN
  IF public.recon_authoritative_access_decision('f4400000-0000-4000-8000-000000000022','view') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'platform-only actor entered mapped tenant data';
  END IF;
  IF public.recon_authoritative_access_decision('f4400000-0000-4000-8000-000000000021','view') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'legacy helper platform-admin result changed before per-row cutover';
  END IF;
  IF public.recon_authoritative_access_decision('f4400000-0000-4000-8000-000000000024','view') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'legacy helper platform-admin result changed for a cross-tenant definition';
  END IF;
END
$platform_only$;
RESET ROLE;

-- An actor from tenant A must not gain access to a fully mapped tenant-B
-- definition, even when the caller supplies only its valid resource UUID.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000012',true);
DO $mapped_cross_tenant$
BEGIN
  IF public.recon_authoritative_access_decision('f4400000-0000-4000-8000-000000000024','view') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'tenant-A actor accessed a mapped tenant-B definition';
  END IF;
END
$mapped_cross_tenant$;
RESET ROLE;

-- Removing a group membership revokes its grant on the very next decision.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000013',true);
DO $group_before_removal$
BEGIN
  IF public.recon_authoritative_access_decision('f4400000-0000-4000-8000-000000000022','view') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'group view grant was not effective before membership removal';
  END IF;
END
$group_before_removal$;
RESET ROLE;
DELETE FROM public.tenant_group_members
WHERE group_id='f4400000-0000-4000-8000-000000000031'
  AND user_id='f4400000-0000-4000-8000-000000000013';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000013',true);
DO $group_after_removal$
BEGIN
  IF public.recon_authoritative_access_decision('f4400000-0000-4000-8000-000000000022','view') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'removed group member retained view access';
  END IF;
END
$group_after_removal$;
RESET ROLE;

-- Any archived owning BU invalidates the mapped owner set, including grants
-- held through another still-active BU.
UPDATE public.business_units
SET is_archived=true
WHERE tenant_id='f4400000-0000-4000-8000-000000000003'
  AND id='f4400000-0000-4000-8000-000000000041';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','f4400000-0000-4000-8000-000000000012',true);
DO $archived_owner$
BEGIN
  IF public.recon_authoritative_access_decision('f4400000-0000-4000-8000-000000000022','run') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'mapped definition with an archived owner BU retained access';
  END IF;
END
$archived_owner$;
RESET ROLE;

ROLLBACK;
