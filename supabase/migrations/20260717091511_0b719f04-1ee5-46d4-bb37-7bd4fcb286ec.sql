-- Tighten certification_quizzes RLS: hide answer keys from client-readable path
DROP POLICY IF EXISTS "Anyone authenticated can view quizzes" ON public.certification_quizzes;

CREATE POLICY "Platform admins can view quizzes"
  ON public.certification_quizzes
  FOR SELECT
  TO authenticated
  USING (public.is_platform_admin(auth.uid()));

-- Ensure only service_role (and platform admins via policy) can reach the table.
REVOKE SELECT ON public.certification_quizzes FROM anon;