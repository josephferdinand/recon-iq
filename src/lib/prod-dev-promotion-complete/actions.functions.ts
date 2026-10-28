import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { commandSchema, uuid } from "./protocol";
async function service(context: {
  supabase: unknown;
  userId: string;
  claims: { sub?: unknown; aal?: unknown; exp?: unknown };
}) {
  const [{ PromotionService }, { supabaseAdmin }, { getRuntimeEnv }] = await Promise.all([
    import("./service.server"),
    import("@/integrations/supabase/client.server"),
    import("@/lib/runtime-env.server"),
  ]);
  const ref =
    getRuntimeEnv("SUPABASE_PROJECT_ID") ??
    getRuntimeEnv("SUPABASE_URL")?.match(/^https:\/\/([a-z]{20})\.supabase\.co\/?$/)?.[1];
  if (!ref) throw Error("Registered runtime environment unavailable");
  return new PromotionService(
    context.supabase as import("@supabase/supabase-js").SupabaseClient,
    supabaseAdmin,
    context.userId,
    ref,
    context.claims,
  );
}
export const promotionOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((x: unknown) => z.object({ tenantId: uuid }).parse(x))
  .handler(async ({ data, context }) => (await service(context)).overview(data.tenantId));
export const promotionCommand = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((x: unknown) => commandSchema.parse(x))
  .handler(async ({ data, context }) => (await service(context)).command(data));
export const promotionOutcome = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((x: unknown) =>
    z.object({ tenantId: uuid, key: z.string().regex(/^[a-zA-Z0-9_-]{8,128}$/) }).parse(x),
  )
  .handler(async ({ data, context }) => (await service(context)).outcome(data.tenantId, data.key));
export const promotionExport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((x: unknown) => z.object({ tenantId: uuid, id: uuid }).parse(x))
  .handler(async ({ data, context }) => (await service(context)).export(data.tenantId, data.id));
export const promotionReceive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((x: unknown) =>
    z
      .object({
        tenantId: uuid,
        key: z.string().regex(/^[a-zA-Z0-9_-]{8,128}$/),
        envelope: z
          .object({
            schema_version: z.literal(1),
            payload: z.string().min(10).max(2000000),
            signature: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      })
      .parse(x),
  )
  .handler(async ({ data, context }) =>
    (await service(context)).receive(data.tenantId, data.key, data.envelope),
  );
