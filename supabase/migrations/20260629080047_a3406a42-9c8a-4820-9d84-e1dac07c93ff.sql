ALTER FUNCTION public.audit_log_chain() SET search_path = public, extensions;
ALTER FUNCTION public.verify_audit_chain(integer) SET search_path = public, extensions;
ALTER FUNCTION public.tg_signoff_guard() SET search_path = public, extensions;
ALTER FUNCTION public.worm_append(uuid, text, text, text, text, bigint, text, text, integer) SET search_path = public, extensions;
ALTER FUNCTION public.advance_signoff(uuid, text, text, text) SET search_path = public, extensions;