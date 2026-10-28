import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { z } from 'zod';

export const listProcessLibrary = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ category: z.string().optional(), assetClass: z.string().optional() }).parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from('process_library')
      .select('id,slug,title,summary,category,asset_class,version,published,updated_at')
      .eq('published', true)
      .order('title');
    if (data.category) q = q.eq('category', data.category);
    if (data.assetClass) q = q.eq('asset_class', data.assetClass);
    const { data: rows, error } = await q;
    if (error) throw error;
    return rows ?? [];
  });

export const getProcessBlueprint = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ slug: z.string().min(1) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from('process_library')
      .select('*')
      .eq('slug', data.slug)
      .eq('published', true)
      .maybeSingle();
    if (error) throw error;
    return row;
  });
