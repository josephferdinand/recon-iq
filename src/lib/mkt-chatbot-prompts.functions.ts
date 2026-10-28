import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { assertMktRole } from "./mkt-admin.functions";
import { MKT_TAB_ROLES } from "./mkt-admin-roles";

export type ChatbotPrompt = {
  id: string;
  key: string;
  label: string;
  system_prompt: string;
  greeting: string | null;
  model_hint: string | null;
  temperature: number;
  is_active: boolean;
  updated_at: string;
};

export const listChatbotPrompts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }): Promise<ChatbotPrompt[]> => {
    await assertMktRole(context, MKT_TAB_ROLES.chatbot);
    const { data, error } = await context.supabase
      .from("mkt_chatbot_prompts")
      .select("id,key,label,system_prompt,greeting,model_hint,temperature,is_active,updated_at")
      .order("key", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as ChatbotPrompt[];
  });

const promptInput = z.object({
  id: z.string().uuid().optional(),
  key: z.string().min(1).max(80).regex(/^[a-z0-9_]+$/, "lowercase, digits, underscore only"),
  label: z.string().min(1).max(120),
  system_prompt: z.string().min(20).max(20000),
  greeting: z.string().max(2000).optional().nullable(),
  model_hint: z.string().max(120).optional().nullable(),
  temperature: z.number().min(0).max(2),
  is_active: z.boolean(),
});

export const upsertChatbotPrompt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => promptInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertMktRole(context, MKT_TAB_ROLES.chatbot);
    let before: unknown = null;
    if (data.id) {
      const { data: existing } = await context.supabase
        .from("mkt_chatbot_prompts").select("*").eq("id", data.id).maybeSingle();
      before = existing ?? null;
    }
    const { data: row, error } = await context.supabase
      .from("mkt_chatbot_prompts")
      .upsert({ ...data, updated_by: context.userId }, { onConflict: "key" })
      .select("id").single();
    if (error) throw new Error(error.message);
    const { logMktChange } = await import("./mkt-audit.server");
    await logMktChange({
      entity_type: "chatbot_prompt",
      entity_key: row.id,
      action: before ? "update" : "create",
      actor_id: context.userId,
      actor_email: (context.claims as { email?: string } | undefined)?.email ?? null,
      before: before as never,
      after: { ...data, id: row.id } as never,
      summary: `${before ? "Updated" : "Created"} chatbot prompt "${data.label}"`,
    });
    return { id: row.id };
  });

export const deleteChatbotPrompt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMktRole(context, MKT_TAB_ROLES.chatbot);
    const { data: existing } = await context.supabase
      .from("mkt_chatbot_prompts").select("*").eq("id", data.id).maybeSingle();
    const { error } = await context.supabase
      .from("mkt_chatbot_prompts").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    if (existing) {
      const { logMktChange } = await import("./mkt-audit.server");
      await logMktChange({
        entity_type: "chatbot_prompt",
        entity_key: data.id,
        action: "delete",
        actor_id: context.userId,
        actor_email: (context.claims as { email?: string } | undefined)?.email ?? null,
        before: existing as never,
        after: null,
        summary: `Deleted chatbot prompt "${(existing as { label?: string }).label ?? data.id}"`,
      });
    }
    return { ok: true };
  });
