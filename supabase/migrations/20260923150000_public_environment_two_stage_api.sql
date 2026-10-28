-- Governed public API entry points. The bearer token is resolved by the app;
-- these service-role functions still recheck actor, tenant and review stage.
CREATE OR REPLACE FUNCTION public.request_source_environment_change_for_api(
  _request jsonb, _actor_user_id uuid
) RETURNS TABLE(request_id uuid,change_request_uid text,request_status text,manifest_hash text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
BEGIN
  IF nullif(_request->>'source_tenant_id','')::uuid IS DISTINCT FROM
     nullif(_request->>'control_tenant_id','')::uuid THEN
    RAISE EXCEPTION 'Source tenant must match the control tenant';
  END IF;
  RETURN QUERY SELECT * FROM public.request_source_environment_change_as(_request,_actor_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.decide_source_environment_change_for_api(
  _request_id uuid, _approve boolean, _comment text, _actor_user_id uuid
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE target public.environment_change_requests%ROWTYPE;
BEGIN
  SELECT * INTO target FROM public.environment_change_requests WHERE id=_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Environment change request not found'; END IF;
  IF target.approval_stage<>'source_review' OR
     target.control_tenant_id IS DISTINCT FROM target.source_tenant_id THEN
    RAISE EXCEPTION 'Source review is required';
  END IF;
  RETURN public.decide_environment_change_as(_request_id,_approve,_comment,_actor_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_incoming_environment_change_for_api(
  _request_id uuid, _approve boolean, _comment text,
  _confirm_access_mapping boolean, _actor_user_id uuid
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE target public.environment_change_requests%ROWTYPE;
BEGIN
  SELECT * INTO target FROM public.environment_change_requests WHERE id=_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Environment change request not found'; END IF;
  IF target.approval_stage<>'target_review' OR
     target.control_tenant_id IS DISTINCT FROM target.target_tenant_id OR
     target.source_requester_email_hash IS NULL THEN
    RAISE EXCEPTION 'Bound incoming target review is required';
  END IF;
  RETURN public.approve_incoming_environment_change_as(
    _request_id,_approve,_comment,_confirm_access_mapping,_actor_user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.request_source_environment_change_for_api(jsonb,uuid)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.decide_source_environment_change_for_api(uuid,boolean,text,uuid)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.approve_incoming_environment_change_for_api(uuid,boolean,text,boolean,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.request_source_environment_change_for_api(jsonb,uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.decide_source_environment_change_for_api(uuid,boolean,text,uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.approve_incoming_environment_change_for_api(uuid,boolean,text,boolean,uuid)
  TO service_role;

-- Retire direct target creation/decision entry points. Keep the authenticated
-- source decision signature used by the app, but constrain it to source stage.
REVOKE EXECUTE ON FUNCTION public.request_environment_change(jsonb)
  FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.request_environment_change_for_api(jsonb,uuid)
  FROM service_role;
REVOKE EXECUTE ON FUNCTION public.decide_environment_change_for_api(uuid,boolean,text,uuid)
  FROM service_role;
CREATE OR REPLACE FUNCTION public.decide_environment_change(
  _request_id uuid, _approve boolean, _comment text
) RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path=public
AS $$
  SELECT public.decide_source_environment_change_for_api(
    _request_id,_approve,_comment,auth.uid())
$$;
