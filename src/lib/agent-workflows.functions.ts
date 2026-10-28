import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { z } from 'zod';

const GraphNode = z.object({
  id: z.string().min(1),
  role: z.string().min(1), // e.g. "researcher", "matcher", "approver", "narrator"
  prompt: z.string().max(4000).optional(),
  next: z.array(z.string()).default([]),
});

const Graph = z.object({
  nodes: z.array(GraphNode).max(50),
  entry: z.string().min(1),
});

export const listWorkflows = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenantId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from('agent_workflows')
      .select('id,name,description,enabled,graph,updated_at')
      .eq('tenant_id', data.tenantId)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return rows ?? [];
  });

export const upsertWorkflow = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        tenantId: z.string().uuid(),
        name: z.string().min(2).max(120),
        description: z.string().max(500).optional(),
        graph: Graph,
        enabled: z.boolean().default(false),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const payload = {
      tenant_id: data.tenantId,
      name: data.name,
      description: data.description ?? null,
      graph: data.graph as never,
      enabled: data.enabled,
      created_by: context.userId,
    };
    if (data.id) {
      const { error } = await context.supabase
        .from('agent_workflows')
        .update(payload)
        .eq('id', data.id);
      if (error) throw error;
      return { id: data.id };
    }
    const { data: row, error } = await context.supabase
      .from('agent_workflows')
      .insert(payload)
      .select('id')
      .single();
    if (error) throw error;
    return { id: row.id };
  });

export const listWorkflowRuns = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ workflowId: z.string().uuid(), limit: z.number().int().min(1).max(100).default(25) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from('agent_workflow_runs')
      .select('id,status,started_at,finished_at,trace')
      .eq('workflow_id', data.workflowId)
      .order('started_at', { ascending: false })
      .limit(data.limit);
    if (error) throw error;
    return rows ?? [];
  });
