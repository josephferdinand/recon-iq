DROP POLICY IF EXISTS "kb screenshots read auth" ON storage.objects;
CREATE POLICY "kb screenshots read platform admin"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'kb-screenshots' AND public.is_platform_admin(auth.uid()));