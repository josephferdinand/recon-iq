-- Local/source implementation slice for bilateral VM CSA governance.
-- This does not integrate collateral valuation or the reconciliation engine.

CREATE TABLE public.collateral_csa_agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  agreement_key text NOT NULL CHECK (length(btrim(agreement_key)) BETWEEN 1 AND 120),
  own_legal_entity text NOT NULL CHECK (length(btrim(own_legal_entity)) BETWEEN 1 AND 160),
  counterparty text NOT NULL CHECK (length(btrim(counterparty)) BETWEEN 1 AND 160),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, agreement_key),
  UNIQUE (tenant_id, id)
);

CREATE TABLE public.collateral_csa_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  agreement_id uuid NOT NULL,
  version_no integer NOT NULL CHECK (version_no > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','active','superseded','rejected')),
  threshold_amount numeric(20,4) NOT NULL CHECK (threshold_amount >= 0),
  minimum_transfer numeric(20,4) NOT NULL CHECK (minimum_transfer >= 0),
  rounding_increment numeric(20,4) NOT NULL DEFAULT 0 CHECK (rounding_increment >= 0),
  effective_from date NOT NULL,
  effective_to date,
  terms_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(terms_snapshot) = 'object'),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_by uuid REFERENCES auth.users(id),
  submitted_at timestamptz,
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 120),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  FOREIGN KEY (tenant_id, agreement_id) REFERENCES public.collateral_csa_agreements(tenant_id, id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, agreement_id, version_no),
  UNIQUE (tenant_id, agreement_id, id),
  UNIQUE (tenant_id, created_by, idempotency_key),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CHECK ((status IN ('draft','rejected') AND approved_by IS NULL AND approved_at IS NULL)
      OR (status IN ('pending_approval','active','superseded') AND submitted_by IS NOT NULL AND submitted_at IS NOT NULL)),
  CHECK (approved_by IS NULL OR approved_by <> created_by)
);

CREATE UNIQUE INDEX collateral_csa_one_active_version_idx
  ON public.collateral_csa_versions(tenant_id, agreement_id) WHERE status = 'active';

CREATE TABLE public.collateral_csa_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  agreement_id uuid NOT NULL,
  version_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 120),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  valuation_date date NOT NULL,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  calculated_by uuid NOT NULL REFERENCES auth.users(id),
  gross_exposure numeric(20,4) NOT NULL,
  eligible_collateral_held numeric(20,4) NOT NULL,
  net_exposure numeric(20,4) NOT NULL,
  threshold_snapshot numeric(20,4) NOT NULL,
  minimum_transfer_snapshot numeric(20,4) NOT NULL,
  rounding_increment_snapshot numeric(20,4) NOT NULL,
  call_amount numeric(20,4) NOT NULL CHECK (call_amount >= 0),
  direction text NOT NULL CHECK (direction IN ('none','counterparty_to_us','us_to_counterparty')),
  status text NOT NULL DEFAULT 'pending_approval' CHECK (status IN ('pending_approval','approved','disputed','partially_settled','settled')),
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  settled_amount numeric(20,4) NOT NULL DEFAULT 0 CHECK (settled_amount >= 0 AND settled_amount <= call_amount),
  FOREIGN KEY (tenant_id, agreement_id) REFERENCES public.collateral_csa_agreements(tenant_id, id),
  FOREIGN KEY (tenant_id, agreement_id, version_id) REFERENCES public.collateral_csa_versions(tenant_id, agreement_id, id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, calculated_by, idempotency_key),
  CHECK (approved_by IS NULL OR approved_by <> calculated_by),
  CHECK ((status = 'pending_approval' AND approved_by IS NULL AND approved_at IS NULL)
      OR (status <> 'pending_approval' AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
      OR (status = 'disputed' AND approved_by IS NOT NULL AND approved_at IS NOT NULL))
);

CREATE TABLE public.collateral_csa_call_disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  call_id uuid NOT NULL,
  disputed_amount numeric(20,4) NOT NULL CHECK (disputed_amount > 0),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 120),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  raised_by uuid NOT NULL REFERENCES auth.users(id),
  raised_at timestamptz NOT NULL DEFAULT now(),
  resolved_by uuid REFERENCES auth.users(id),
  resolved_at timestamptz,
  resolution text,
  FOREIGN KEY (tenant_id, call_id) REFERENCES public.collateral_csa_calls(tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  CHECK ((resolved_by IS NULL AND resolved_at IS NULL AND resolution IS NULL)
      OR (resolved_by IS NOT NULL AND resolved_at IS NOT NULL AND length(btrim(resolution)) > 0))
);

CREATE TABLE public.collateral_csa_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  call_id uuid NOT NULL,
  amount numeric(20,4) NOT NULL CHECK (amount > 0),
  settled_at timestamptz NOT NULL DEFAULT now(),
  settlement_reference text NOT NULL CHECK (length(btrim(settlement_reference)) BETWEEN 1 AND 160),
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 120),
  recorded_by uuid NOT NULL REFERENCES auth.users(id),
  FOREIGN KEY (tenant_id, call_id) REFERENCES public.collateral_csa_calls(tenant_id, id),
  UNIQUE (tenant_id, idempotency_key)
);

ALTER TABLE public.collateral_csa_agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collateral_csa_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collateral_csa_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collateral_csa_call_disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collateral_csa_settlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY collateral_csa_agreement_read ON public.collateral_csa_agreements FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY collateral_csa_version_read ON public.collateral_csa_versions FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY collateral_csa_call_read ON public.collateral_csa_calls FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY collateral_csa_dispute_read ON public.collateral_csa_call_disputes FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY collateral_csa_settlement_read ON public.collateral_csa_settlements FOR SELECT TO authenticated
  USING (public.is_tenant_member(auth.uid(), tenant_id) OR public.is_platform_admin(auth.uid()));

GRANT SELECT ON public.collateral_csa_agreements, public.collateral_csa_versions,
  public.collateral_csa_calls, public.collateral_csa_call_disputes,
  public.collateral_csa_settlements TO authenticated;
GRANT ALL ON public.collateral_csa_agreements, public.collateral_csa_versions,
  public.collateral_csa_calls, public.collateral_csa_call_disputes,
  public.collateral_csa_settlements TO service_role;
REVOKE INSERT, UPDATE, DELETE ON public.collateral_csa_agreements,
  public.collateral_csa_versions, public.collateral_csa_calls,
  public.collateral_csa_call_disputes, public.collateral_csa_settlements FROM authenticated;

CREATE OR REPLACE FUNCTION public.create_collateral_csa_draft(
  _tenant_id uuid,
  _agreement_id uuid,
  _agreement_key text,
  _own_legal_entity text,
  _counterparty text,
  _currency text,
  _threshold_amount numeric,
  _minimum_transfer numeric,
  _rounding_increment numeric,
  _effective_from date,
  _effective_to date,
  _terms_snapshot jsonb,
  _idempotency_key text
) RETURNS TABLE(agreement_id uuid, version_id uuid, version_no integer, replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  actor uuid := auth.uid();
  agreement_row public.collateral_csa_agreements%ROWTYPE;
  version_row public.collateral_csa_versions%ROWTYPE;
  request_digest text;
BEGIN
  IF actor IS NULL OR NOT public.has_tenant_role(actor,_tenant_id,'tenant_admin'::public.tenant_role) THEN
    RAISE EXCEPTION 'Active tenant administrator required' USING ERRCODE='42501';
  END IF;
  IF _threshold_amount < 0 OR _minimum_transfer < 0 OR _rounding_increment < 0
     OR _effective_to IS NOT NULL AND _effective_to < _effective_from
     OR _currency !~ '^[A-Z]{3}$' OR _terms_snapshot IS NULL OR jsonb_typeof(_terms_snapshot) <> 'object' THEN
    RAISE EXCEPTION 'Invalid bilateral VM agreement terms' USING ERRCODE='22023';
  END IF;
  request_digest := encode(digest(jsonb_build_object(
    'agreement_id',_agreement_id,'agreement_key',_agreement_key,'own_legal_entity',_own_legal_entity,
    'counterparty',_counterparty,'currency',_currency,'threshold_amount',_threshold_amount,
    'minimum_transfer',_minimum_transfer,'rounding_increment',_rounding_increment,
    'effective_from',_effective_from,'effective_to',_effective_to,'terms_snapshot',_terms_snapshot
  )::text,'sha256'),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(_tenant_id::text||':'||actor::text||':'||_idempotency_key,0));
  SELECT * INTO version_row FROM public.collateral_csa_versions
    WHERE tenant_id=_tenant_id AND created_by=actor AND idempotency_key=_idempotency_key;
  IF FOUND THEN
    IF version_row.request_hash <> request_digest THEN RAISE EXCEPTION 'Idempotency key reused with different agreement terms' USING ERRCODE='22023'; END IF;
    RETURN QUERY SELECT version_row.agreement_id,version_row.id,version_row.version_no,true; RETURN;
  END IF;
  IF _agreement_id IS NULL THEN
    IF _agreement_key IS NULL OR _own_legal_entity IS NULL OR _counterparty IS NULL THEN
      RAISE EXCEPTION 'New agreement identity is required' USING ERRCODE='22023';
    END IF;
    INSERT INTO public.collateral_csa_agreements(tenant_id,agreement_key,own_legal_entity,counterparty,currency,created_by)
    VALUES (_tenant_id,_agreement_key,_own_legal_entity,_counterparty,_currency,actor) RETURNING * INTO agreement_row;
  ELSE
    SELECT * INTO agreement_row FROM public.collateral_csa_agreements
      WHERE id=_agreement_id AND tenant_id=_tenant_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Agreement is unavailable in this tenant' USING ERRCODE='42501'; END IF;
    IF agreement_row.currency IS DISTINCT FROM _currency OR agreement_row.agreement_key IS DISTINCT FROM _agreement_key
       OR agreement_row.own_legal_entity IS DISTINCT FROM _own_legal_entity OR agreement_row.counterparty IS DISTINCT FROM _counterparty THEN
      RAISE EXCEPTION 'Agreement identity is immutable' USING ERRCODE='22023';
    END IF;
  END IF;
  INSERT INTO public.collateral_csa_versions(tenant_id,agreement_id,version_no,threshold_amount,minimum_transfer,
    rounding_increment,effective_from,effective_to,terms_snapshot,created_by,idempotency_key,request_hash)
  SELECT _tenant_id,agreement_row.id,coalesce(max(v.version_no),0)+1,_threshold_amount,_minimum_transfer,
    _rounding_increment,_effective_from,_effective_to,coalesce(_terms_snapshot,'{}'::jsonb),actor,_idempotency_key,request_digest
  FROM public.collateral_csa_versions v WHERE v.tenant_id=_tenant_id AND v.agreement_id=agreement_row.id
  RETURNING * INTO version_row;
  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
  VALUES(actor,_tenant_id,'tenant','collateral.csa.version.draft','collateral_csa_version',version_row.id::text,
    jsonb_build_object('agreement_id',agreement_row.id,'version_no',version_row.version_no,'currency',_currency));
  RETURN QUERY SELECT agreement_row.id,version_row.id,version_row.version_no,false;
END $$;

CREATE OR REPLACE FUNCTION public.submit_collateral_csa_version(_tenant_id uuid,_version_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor uuid := auth.uid(); version_row public.collateral_csa_versions%ROWTYPE;
BEGIN
  IF actor IS NULL OR NOT public.has_tenant_role(actor,_tenant_id,'tenant_admin'::public.tenant_role) THEN
    RAISE EXCEPTION 'Active tenant administrator required' USING ERRCODE='42501';
  END IF;
  SELECT * INTO version_row FROM public.collateral_csa_versions WHERE tenant_id=_tenant_id AND id=_version_id FOR UPDATE;
  IF NOT FOUND OR version_row.created_by<>actor OR version_row.status<>'draft' THEN
    RAISE EXCEPTION 'Only the draft author can submit a draft version' USING ERRCODE='42501';
  END IF;
  UPDATE public.collateral_csa_versions SET status='pending_approval',submitted_by=actor,submitted_at=now() WHERE id=_version_id;
  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
  VALUES(actor,_tenant_id,'tenant','collateral.csa.version.submit','collateral_csa_version',_version_id::text,jsonb_build_object('version_no',version_row.version_no));
  RETURN 'pending_approval';
END $$;

CREATE OR REPLACE FUNCTION public.decide_collateral_csa_version(_tenant_id uuid,_version_id uuid,_approve boolean,_reason text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor uuid := auth.uid(); version_row public.collateral_csa_versions%ROWTYPE; other_active public.collateral_csa_versions%ROWTYPE;
BEGIN
  IF actor IS NULL OR NOT public.has_tenant_role(actor,_tenant_id,'tenant_admin'::public.tenant_role) THEN
    RAISE EXCEPTION 'Active tenant administrator required' USING ERRCODE='42501';
  END IF;
  SELECT * INTO version_row FROM public.collateral_csa_versions WHERE tenant_id=_tenant_id AND id=_version_id FOR UPDATE;
  IF NOT FOUND OR version_row.status<>'pending_approval' THEN RAISE EXCEPTION 'Version is not awaiting approval' USING ERRCODE='22023'; END IF;
  IF actor=version_row.created_by OR actor=version_row.submitted_by THEN RAISE EXCEPTION 'Maker and checker must be different users' USING ERRCODE='42501'; END IF;
  IF _approve THEN
    PERFORM 1 FROM public.collateral_csa_agreements WHERE tenant_id=_tenant_id AND id=version_row.agreement_id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM public.collateral_csa_versions v WHERE v.tenant_id=_tenant_id AND v.agreement_id=version_row.agreement_id
      AND v.status IN ('active','superseded') AND daterange(v.effective_from,v.effective_to,'[]')
        && daterange(version_row.effective_from,version_row.effective_to,'[]')) THEN
      RAISE EXCEPTION 'Effective period overlaps the current active agreement version' USING ERRCODE='22023';
    END IF;
    SELECT * INTO other_active FROM public.collateral_csa_versions WHERE tenant_id=_tenant_id AND agreement_id=version_row.agreement_id AND id<>_version_id AND status='active';
    IF FOUND THEN UPDATE public.collateral_csa_versions SET status='superseded' WHERE id=other_active.id; END IF;
    UPDATE public.collateral_csa_versions SET status='active',approved_by=actor,approved_at=now() WHERE id=_version_id;
  ELSE
    UPDATE public.collateral_csa_versions SET status='rejected' WHERE id=_version_id;
  END IF;
  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
  VALUES(actor,_tenant_id,'tenant',CASE WHEN _approve THEN 'collateral.csa.version.activate' ELSE 'collateral.csa.version.reject' END,
    'collateral_csa_version',_version_id::text,jsonb_build_object('version_no',version_row.version_no,'reason',left(coalesce(_reason,''),1000)));
  RETURN CASE WHEN _approve THEN 'active' ELSE 'rejected' END;
END $$;

CREATE OR REPLACE FUNCTION public.calculate_collateral_vm_call(
  _tenant_id uuid,_version_id uuid,_valuation_date date,_gross_exposure numeric,
  _eligible_collateral_held numeric,_idempotency_key text
) RETURNS TABLE(call_id uuid,call_amount numeric,direction text,replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  actor uuid := auth.uid(); v public.collateral_csa_versions%ROWTYPE; existing public.collateral_csa_calls%ROWTYPE;
  net numeric; raw_call numeric; amount numeric; call_direction text; request_hash text;
BEGIN
  IF actor IS NULL OR NOT public.has_tenant_role(actor,_tenant_id,'tenant_admin'::public.tenant_role) THEN
    RAISE EXCEPTION 'Active tenant administrator required' USING ERRCODE='42501';
  END IF;
  IF _gross_exposure IS NULL OR _eligible_collateral_held IS NULL OR _eligible_collateral_held < 0 OR _valuation_date IS NULL OR _idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Exposure, collateral, valuation date and idempotency key are required' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v FROM public.collateral_csa_versions WHERE tenant_id=_tenant_id AND id=_version_id AND status IN ('active','superseded')
    AND _valuation_date BETWEEN effective_from AND coalesce(effective_to,'infinity'::date);
  IF NOT FOUND THEN RAISE EXCEPTION 'An active agreement version for the valuation date is required' USING ERRCODE='22023'; END IF;
  request_hash := encode(digest(jsonb_build_object('version_id',_version_id,'valuation_date',_valuation_date,
    'gross_exposure',_gross_exposure,'eligible_collateral_held',_eligible_collateral_held)::text,'sha256'),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(_tenant_id::text||':'||actor::text||':'||_idempotency_key,0));
  SELECT * INTO existing FROM public.collateral_csa_calls WHERE tenant_id=_tenant_id AND calculated_by=actor AND idempotency_key=_idempotency_key;
  IF FOUND THEN
    IF existing.request_hash<>request_hash THEN RAISE EXCEPTION 'Idempotency key reused with different call inputs' USING ERRCODE='22023'; END IF;
    RETURN QUERY SELECT existing.id,existing.call_amount,existing.direction,true; RETURN;
  END IF;
  net := _gross_exposure - _eligible_collateral_held;
  raw_call := greatest(abs(net)-v.threshold_amount,0);
  IF raw_call < v.minimum_transfer THEN raw_call := 0; END IF;
  amount := CASE WHEN v.rounding_increment=0 THEN raw_call ELSE round(raw_call/v.rounding_increment)*v.rounding_increment END;
  call_direction := CASE WHEN amount=0 THEN 'none' WHEN net>0 THEN 'counterparty_to_us' ELSE 'us_to_counterparty' END;
  INSERT INTO public.collateral_csa_calls(tenant_id,agreement_id,version_id,idempotency_key,request_hash,valuation_date,
    calculated_by,gross_exposure,eligible_collateral_held,net_exposure,threshold_snapshot,minimum_transfer_snapshot,
    rounding_increment_snapshot,call_amount,direction)
  VALUES(_tenant_id,v.agreement_id,_version_id,_idempotency_key,request_hash,_valuation_date,actor,_gross_exposure,
    _eligible_collateral_held,net,v.threshold_amount,v.minimum_transfer,v.rounding_increment,amount,call_direction)
  RETURNING * INTO existing;
  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
  VALUES(actor,_tenant_id,'tenant','collateral.vm.call.calculate','collateral_csa_call',existing.id::text,
    jsonb_build_object('version_id',_version_id,'valuation_date',_valuation_date,'gross_exposure',_gross_exposure,
      'eligible_collateral_held',_eligible_collateral_held,'net_exposure',net,'call_amount',amount,'direction',call_direction));
  RETURN QUERY SELECT existing.id,amount,call_direction,false;
END $$;

CREATE OR REPLACE FUNCTION public.approve_collateral_vm_call(_tenant_id uuid,_call_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor uuid := auth.uid(); c public.collateral_csa_calls%ROWTYPE;
BEGIN
  IF actor IS NULL OR NOT public.has_tenant_role(actor,_tenant_id,'tenant_admin'::public.tenant_role) THEN RAISE EXCEPTION 'Active tenant administrator required' USING ERRCODE='42501'; END IF;
  SELECT * INTO c FROM public.collateral_csa_calls WHERE tenant_id=_tenant_id AND id=_call_id FOR UPDATE;
  IF NOT FOUND OR c.status<>'pending_approval' THEN RAISE EXCEPTION 'Call is not awaiting approval' USING ERRCODE='22023'; END IF;
  IF actor=c.calculated_by THEN RAISE EXCEPTION 'Call maker cannot approve own calculation' USING ERRCODE='42501'; END IF;
  UPDATE public.collateral_csa_calls SET status='approved',approved_by=actor,approved_at=now() WHERE id=_call_id;
  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
  VALUES(actor,_tenant_id,'tenant','collateral.vm.call.approve','collateral_csa_call',_call_id::text,jsonb_build_object('amount',c.call_amount));
  RETURN 'approved';
END $$;

CREATE OR REPLACE FUNCTION public.dispute_collateral_vm_call(_tenant_id uuid,_call_id uuid,_amount numeric,_reason text,_idempotency_key text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor uuid := auth.uid(); c public.collateral_csa_calls%ROWTYPE; dispute_id uuid; existing public.collateral_csa_call_disputes%ROWTYPE; request_hash text;
BEGIN
  IF actor IS NULL OR NOT public.has_tenant_role(actor,_tenant_id,'tenant_admin'::public.tenant_role) THEN RAISE EXCEPTION 'Active tenant administrator required' USING ERRCODE='42501'; END IF;
  SELECT * INTO c FROM public.collateral_csa_calls WHERE tenant_id=_tenant_id AND id=_call_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Call is unavailable in this tenant' USING ERRCODE='42501'; END IF;
  request_hash := encode(digest(jsonb_build_object('call_id',_call_id,'amount',_amount,'reason',_reason,'actor',actor)::text,'sha256'),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(_tenant_id::text||':'||_idempotency_key,0));
  SELECT * INTO existing FROM public.collateral_csa_call_disputes WHERE tenant_id=_tenant_id AND idempotency_key=_idempotency_key;
  IF FOUND THEN
    IF existing.request_hash<>request_hash THEN RAISE EXCEPTION 'Idempotency key reused with different dispute details' USING ERRCODE='22023'; END IF;
    RETURN existing.id;
  END IF;
  IF actor=c.calculated_by OR c.status NOT IN ('approved','partially_settled') OR _amount<=0 OR _amount>c.call_amount-c.settled_amount THEN
    RAISE EXCEPTION 'Dispute amount or call state is invalid' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.collateral_csa_call_disputes(tenant_id,call_id,disputed_amount,reason,idempotency_key,request_hash,raised_by)
  VALUES(_tenant_id,_call_id,_amount,_reason,_idempotency_key,request_hash,actor) RETURNING id INTO dispute_id;
  UPDATE public.collateral_csa_calls SET status='disputed' WHERE id=_call_id;
  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
  VALUES(actor,_tenant_id,'tenant','collateral.vm.call.dispute','collateral_csa_call',_call_id::text,jsonb_build_object('dispute_id',dispute_id,'amount',_amount,'reason',left(_reason,1000)));
  RETURN dispute_id;
END $$;

CREATE OR REPLACE FUNCTION public.resolve_collateral_vm_dispute(_tenant_id uuid,_dispute_id uuid,_resolution text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor uuid := auth.uid(); d public.collateral_csa_call_disputes%ROWTYPE; c public.collateral_csa_calls%ROWTYPE;
BEGIN
  IF actor IS NULL OR NOT public.has_tenant_role(actor,_tenant_id,'tenant_admin'::public.tenant_role) THEN RAISE EXCEPTION 'Active tenant administrator required' USING ERRCODE='42501'; END IF;
  SELECT * INTO d FROM public.collateral_csa_call_disputes WHERE tenant_id=_tenant_id AND id=_dispute_id FOR UPDATE;
  IF NOT FOUND OR d.resolved_at IS NOT NULL THEN RAISE EXCEPTION 'Open dispute is unavailable in this tenant' USING ERRCODE='22023'; END IF;
  SELECT * INTO c FROM public.collateral_csa_calls WHERE tenant_id=_tenant_id AND id=d.call_id FOR UPDATE;
  IF actor=d.raised_by OR actor=c.calculated_by OR actor=c.approved_by THEN RAISE EXCEPTION 'Dispute resolver must be independent of maker, checker and dispute raiser' USING ERRCODE='42501'; END IF;
  IF length(btrim(coalesce(_resolution,'')))=0 THEN RAISE EXCEPTION 'Resolution reason is required' USING ERRCODE='22023'; END IF;
  UPDATE public.collateral_csa_call_disputes SET resolved_by=actor,resolved_at=now(),resolution=left(_resolution,1000) WHERE id=_dispute_id;
  UPDATE public.collateral_csa_calls SET status=CASE WHEN settled_amount>0 THEN 'partially_settled' ELSE 'approved' END WHERE id=c.id;
  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
  VALUES(actor,_tenant_id,'tenant','collateral.vm.call.dispute.resolve','collateral_csa_call',c.id::text,jsonb_build_object('dispute_id',_dispute_id,'resolution',left(_resolution,1000)));
  RETURN 'resolved';
END $$;

CREATE OR REPLACE FUNCTION public.record_collateral_vm_settlement(_tenant_id uuid,_call_id uuid,_amount numeric,_reference text,_idempotency_key text)
RETURNS TABLE(settlement_id uuid,call_status text,replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor uuid := auth.uid(); c public.collateral_csa_calls%ROWTYPE; existing public.collateral_csa_settlements%ROWTYPE; total numeric;
BEGIN
  IF actor IS NULL OR NOT public.has_tenant_role(actor,_tenant_id,'tenant_admin'::public.tenant_role) THEN RAISE EXCEPTION 'Active tenant administrator required' USING ERRCODE='42501'; END IF;
  SELECT * INTO c FROM public.collateral_csa_calls WHERE tenant_id=_tenant_id AND id=_call_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Call is unavailable in this tenant' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(_tenant_id::text||':'||_idempotency_key,0));
  SELECT * INTO existing FROM public.collateral_csa_settlements WHERE tenant_id=_tenant_id AND idempotency_key=_idempotency_key;
  IF FOUND THEN
    IF existing.call_id<>_call_id OR existing.amount<>_amount OR existing.settlement_reference<>_reference THEN RAISE EXCEPTION 'Idempotency key reused with different settlement details' USING ERRCODE='22023'; END IF;
    RETURN QUERY SELECT existing.id,c.status,true; RETURN;
  END IF;
  IF c.status NOT IN ('approved','partially_settled') OR _amount<=0 OR _amount>c.call_amount-c.settled_amount THEN
    RAISE EXCEPTION 'Settlement amount or call state is invalid' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.collateral_csa_settlements(tenant_id,call_id,amount,settlement_reference,idempotency_key,recorded_by)
  VALUES(_tenant_id,_call_id,_amount,_reference,_idempotency_key,actor) RETURNING * INTO existing;
  total := c.settled_amount + _amount;
  UPDATE public.collateral_csa_calls SET settled_amount=total,status=CASE WHEN total=call_amount THEN 'settled' ELSE 'partially_settled' END WHERE id=_call_id;
  INSERT INTO public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
  VALUES(actor,_tenant_id,'tenant','collateral.vm.call.settle','collateral_csa_call',_call_id::text,
    jsonb_build_object('settlement_id',existing.id,'amount',_amount,'settled_total',total,'status',CASE WHEN total=c.call_amount THEN 'settled' ELSE 'partially_settled' END));
  RETURN QUERY SELECT existing.id,CASE WHEN total=c.call_amount THEN 'settled' ELSE 'partially_settled' END,false;
END $$;

REVOKE ALL ON FUNCTION public.create_collateral_csa_draft(uuid,uuid,text,text,text,text,numeric,numeric,numeric,date,date,jsonb,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.submit_collateral_csa_version(uuid,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.decide_collateral_csa_version(uuid,uuid,boolean,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.calculate_collateral_vm_call(uuid,uuid,date,numeric,numeric,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.approve_collateral_vm_call(uuid,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.dispute_collateral_vm_call(uuid,uuid,numeric,text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.resolve_collateral_vm_dispute(uuid,uuid,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.record_collateral_vm_settlement(uuid,uuid,numeric,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_collateral_csa_draft(uuid,uuid,text,text,text,text,numeric,numeric,numeric,date,date,jsonb,text) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.submit_collateral_csa_version(uuid,uuid) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.decide_collateral_csa_version(uuid,uuid,boolean,text) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.calculate_collateral_vm_call(uuid,uuid,date,numeric,numeric,text) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.approve_collateral_vm_call(uuid,uuid) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.dispute_collateral_vm_call(uuid,uuid,numeric,text,text) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.resolve_collateral_vm_dispute(uuid,uuid,text) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.record_collateral_vm_settlement(uuid,uuid,numeric,text,text) TO authenticated,service_role;
