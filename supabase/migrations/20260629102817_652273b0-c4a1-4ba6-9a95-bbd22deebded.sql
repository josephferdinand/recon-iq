
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.kb_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid NOT NULL REFERENCES public.kb_articles(id) ON DELETE CASCADE,
  tenant_id uuid,
  scope text NOT NULL,
  chunk_index int NOT NULL,
  content text NOT NULL,
  embedding extensions.vector(1536) NOT NULL,
  embedding_model text NOT NULL DEFAULT 'muse/text-embedding-3-small',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (article_id, chunk_index)
);

GRANT SELECT ON public.kb_chunks TO authenticated;
GRANT ALL ON public.kb_chunks TO service_role;

ALTER TABLE public.kb_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "kb_chunks_select_visible"
ON public.kb_chunks
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.kb_articles a
    WHERE a.id = kb_chunks.article_id
      AND a.status = 'published'
      AND (
        a.scope = 'platform'
        OR (a.scope = 'tenant'
            AND EXISTS (
              SELECT 1 FROM public.tenant_members tm
              WHERE tm.tenant_id = a.tenant_id
                AND tm.user_id = auth.uid()
                AND tm.active = true
            ))
      )
  )
);

CREATE INDEX IF NOT EXISTS kb_chunks_article_idx ON public.kb_chunks(article_id);
CREATE INDEX IF NOT EXISTS kb_chunks_embedding_idx
  ON public.kb_chunks USING hnsw (embedding extensions.vector_cosine_ops);

CREATE OR REPLACE FUNCTION public.match_kb_chunks(
  query_embedding extensions.vector(1536),
  _tenant_id uuid DEFAULT NULL,
  match_count int DEFAULT 5
)
RETURNS TABLE (
  article_id uuid,
  chunk_index int,
  content text,
  title text,
  slug text,
  scope text,
  similarity float
)
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  SELECT
    c.article_id,
    c.chunk_index,
    c.content,
    a.title,
    a.slug,
    a.scope::text,
    1 - (c.embedding <=> query_embedding) AS similarity
  FROM public.kb_chunks c
  JOIN public.kb_articles a ON a.id = c.article_id
  WHERE a.status = 'published'
    AND (
      a.scope = 'platform'
      OR (_tenant_id IS NOT NULL AND a.tenant_id = _tenant_id)
    )
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;

REVOKE EXECUTE ON FUNCTION public.match_kb_chunks(extensions.vector, uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_kb_chunks(extensions.vector, uuid, int) TO authenticated;
