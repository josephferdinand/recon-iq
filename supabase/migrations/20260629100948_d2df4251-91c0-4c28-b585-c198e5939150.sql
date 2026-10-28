CREATE POLICY "users read own security events"
ON public.security_events
FOR SELECT
TO authenticated
USING (user_id = auth.uid());