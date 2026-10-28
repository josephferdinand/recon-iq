
-- Restrict SELECT on the answer-key column to service_role only.
REVOKE SELECT ON public.certification_quizzes FROM authenticated;
GRANT SELECT (id, track_id, ordering, question, options, explanation, created_at)
  ON public.certification_quizzes TO authenticated;
-- service_role retains ALL from prior migration.
