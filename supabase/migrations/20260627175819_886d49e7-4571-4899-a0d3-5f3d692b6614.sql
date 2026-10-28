
ALTER TYPE public.llm_provider_kind ADD VALUE IF NOT EXISTS 'google';
ALTER TYPE public.llm_provider_kind ADD VALUE IF NOT EXISTS 'mistral';
ALTER TYPE public.llm_provider_kind ADD VALUE IF NOT EXISTS 'cohere';
ALTER TYPE public.llm_provider_kind ADD VALUE IF NOT EXISTS 'groq';
ALTER TYPE public.llm_provider_kind ADD VALUE IF NOT EXISTS 'perplexity';
ALTER TYPE public.llm_provider_kind ADD VALUE IF NOT EXISTS 'deepseek';
ALTER TYPE public.llm_provider_kind ADD VALUE IF NOT EXISTS 'xai';
