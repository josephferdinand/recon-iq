
ALTER TABLE public.kb_articles
  ADD COLUMN IF NOT EXISTS cover_image_url text,
  ADD COLUMN IF NOT EXISTS summary text,
  ADD COLUMN IF NOT EXISTS read_time_min int NOT NULL DEFAULT 4;

ALTER TABLE public.kb_categories
  ADD COLUMN IF NOT EXISTS cover_image_url text,
  ADD COLUMN IF NOT EXISTS icon_key text;
