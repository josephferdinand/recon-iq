
-- 1) copilot_thread_insights
CREATE TABLE IF NOT EXISTS public.copilot_thread_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.copilot_threads(id) ON DELETE CASCADE,
  tenant_id uuid NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  insights jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS copilot_thread_insights_thread_idx
  ON public.copilot_thread_insights(thread_id, generated_at DESC);

GRANT SELECT, INSERT ON public.copilot_thread_insights TO authenticated;
GRANT ALL ON public.copilot_thread_insights TO service_role;

ALTER TABLE public.copilot_thread_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cti_owner_select"
  ON public.copilot_thread_insights FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.copilot_threads t
      WHERE t.id = copilot_thread_insights.thread_id
        AND t.user_id = auth.uid()
    )
  );
CREATE POLICY "cti_owner_insert"
  ON public.copilot_thread_insights FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.copilot_threads t
      WHERE t.id = copilot_thread_insights.thread_id
        AND t.user_id = auth.uid()
    )
  );

-- 2) copilot_lexicon_overrides (one row per tenant)
CREATE TABLE IF NOT EXISTS public.copilot_lexicon_overrides (
  tenant_id uuid PRIMARY KEY,
  status_synonyms jsonb NOT NULL DEFAULT '{}'::jsonb,
  time_phrases jsonb NOT NULL DEFAULT '[]'::jsonb,
  severity_aliases jsonb NOT NULL DEFAULT '{}'::jsonb,
  role_aliases jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.copilot_lexicon_overrides TO authenticated;
GRANT ALL ON public.copilot_lexicon_overrides TO service_role;

ALTER TABLE public.copilot_lexicon_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clo_tenant_member_select"
  ON public.copilot_lexicon_overrides FOR SELECT TO authenticated
  USING (
    public.is_platform_admin(auth.uid())
    OR public.is_tenant_member(auth.uid(), tenant_id)
  );

-- 3) Hybrid RAG: lexical index + RPC
CREATE INDEX IF NOT EXISTS kb_chunks_content_fts_idx
  ON public.kb_chunks
  USING gin (to_tsvector('english', coalesce(content, '')));

CREATE OR REPLACE FUNCTION public.match_kb_chunks_lexical(
  _query text,
  _tenant_id uuid,
  match_count int DEFAULT 20
)
RETURNS TABLE (
  chunk_id uuid,
  article_id uuid,
  title text,
  slug text,
  scope text,
  content text,
  rank real
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    kc.id AS chunk_id,
    kc.article_id,
    ka.title,
    ka.slug,
    ka.scope::text,
    kc.content,
    ts_rank(to_tsvector('english', coalesce(kc.content, '')),
            websearch_to_tsquery('english', _query))::real AS rank
  FROM public.kb_chunks kc
  JOIN public.kb_articles ka ON ka.id = kc.article_id
  WHERE ka.status = 'published'
    AND (
      ka.scope = 'platform'
      OR (_tenant_id IS NOT NULL AND ka.tenant_id = _tenant_id)
    )
    AND to_tsvector('english', coalesce(kc.content, ''))
        @@ websearch_to_tsquery('english', _query)
  ORDER BY rank DESC
  LIMIT match_count;
$$;

REVOKE EXECUTE ON FUNCTION public.match_kb_chunks_lexical(text, uuid, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_kb_chunks_lexical(text, uuid, int) TO authenticated;
