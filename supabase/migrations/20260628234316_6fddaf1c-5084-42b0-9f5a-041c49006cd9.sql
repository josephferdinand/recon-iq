CREATE POLICY "kb screenshots read auth"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'kb-screenshots');

CREATE POLICY "kb screenshots insert platform admin"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'kb-screenshots' AND public.is_platform_admin(auth.uid()));

CREATE POLICY "kb screenshots update platform admin"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'kb-screenshots' AND public.is_platform_admin(auth.uid()));

CREATE POLICY "kb screenshots delete platform admin"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'kb-screenshots' AND public.is_platform_admin(auth.uid()));
