import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { listConfiguredProviders } from "./catalog.server";

export const listCopilotProviderChoices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) => z.object({ tenant_id: z.string().uuid().nullable() }).strict().parse(input))
  .handler(async ({ data, context }) => listConfiguredProviders(context.supabase, data.tenant_id));
