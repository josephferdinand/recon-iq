-- The original Arctic palette used #0EA5E9 for both text links and filled
-- controls on near-white surfaces. That combination is only about 2.6:1 and
-- fails WCAG 2 AA for normal text. Update only the exact seeded value so a
-- platform administrator's later customization is never overwritten.

UPDATE public.platform_theme_palettes
SET tokens = jsonb_set(tokens, '{primary}', to_jsonb('#0369A1'::text), true),
    updated_at = now()
WHERE slug = 'arctic'
  AND lower(tokens ->> 'primary') = '#0ea5e9';
