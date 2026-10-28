import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requirePlatformAdmin } from "@/lib/rbac-guards.server";
import { readPlatformSecretPresence } from "@/lib/platform-secret-status.server";

export const getPlatformSecretStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    await requirePlatformAdmin(context, { fnName: "platform-secret-status" });

    return {
      checked_at: new Date().toISOString(),
      secrets: readPlatformSecretPresence(),
    };
  });
