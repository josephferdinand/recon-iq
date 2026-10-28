// Approval-time diff for KB write proposals.
// Returns current published-article state alongside the pending proposal
// so approvers can compare title / summary / body_md before executing.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type KbDiffPayload = {
  kind: "create" | "update" | "publish" | "archive";
  tool: string;
  article_id: string | null;
  scope: "tenant" | "platform" | null;
  current: {
    title: string;
    summary: string | null;
    body_md: string;
    status: string;
    category_id: string | null;
  } | null;
  proposed: {
    title: string;
    summary: string | null;
    body_md: string;
    status: string | null;
    category_id: string | null;
  };
};

export const getKbApprovalDiff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d) => z.object({
    tenant_id: z.string().uuid(),
    action_id: z.string().uuid(),
  }).parse(d))
  .handler(async ({ data, context }): Promise<KbDiffPayload> => {
    // Approver-level access: tenant_admin or platform_admin.
    const [{ data: isTenantAdmin }, { data: isPlatformAdmin }] = await Promise.all([
      context.supabase.rpc("has_tenant_role", {
        _user_id: context.userId, _tenant_id: data.tenant_id, _role: "tenant_admin",
      }),
      context.supabase.rpc("is_platform_admin", { _user_id: context.userId }),
    ]);
    if (!isTenantAdmin && !isPlatformAdmin) throw new Error("Forbidden");

    const { data: act, error } = await (context.supabase as any)
      .from("agent_actions")
      .select("id, tool, input, before_state, status")
      .eq("id", data.action_id)
      .eq("tenant_id", data.tenant_id)
      .maybeSingle();
    if (error || !act) throw new Error("Action not found");
    if (!String(act.tool).startsWith("kb_article_")) {
      throw new Error("Not a KB action");
    }

    const input: any = act.input ?? {};
    const beforeState: any = act.before_state ?? {};
    const articleId: string | null = input.article_id ?? null;

    let current: KbDiffPayload["current"] = null;
    let scope: "tenant" | "platform" | null = null;
    if (articleId) {
      const { data: art } = await (context.supabase as any)
        .from("kb_articles")
        .select("scope, title, summary, body_md, status, category_id")
        .eq("id", articleId)
        .maybeSingle();
      if (art) {
        scope = art.scope;
        current = {
          title: art.title ?? "",
          summary: art.summary ?? null,
          body_md: art.body_md ?? "",
          status: art.status ?? "draft",
          category_id: art.category_id ?? null,
        };
      }
    } else if (input.scope) {
      scope = input.scope;
    }

    let kind: KbDiffPayload["kind"];
    let proposed: KbDiffPayload["proposed"];
    switch (act.tool) {
      case "kb_article_create":
        kind = "create";
        proposed = {
          title: input.title ?? "",
          summary: input.summary ?? null,
          body_md: input.body_md ?? "",
          status: input.publish_immediately ? "published" : "draft",
          category_id: input.category_id ?? null,
        };
        break;
      case "kb_article_update":
        kind = "update";
        proposed = {
          title: input.title ?? current?.title ?? "",
          summary: input.summary !== undefined ? input.summary : (current?.summary ?? null),
          body_md: input.body_md ?? current?.body_md ?? "",
          status: current?.status ?? null,
          category_id: input.category_id !== undefined ? input.category_id : (current?.category_id ?? null),
        };
        break;
      case "kb_article_publish":
        kind = "publish";
        proposed = {
          title: current?.title ?? "",
          summary: current?.summary ?? null,
          body_md: current?.body_md ?? "",
          status: input.publish ? "published" : "draft",
          category_id: current?.category_id ?? null,
        };
        break;
      case "kb_article_archive":
        kind = "archive";
        proposed = {
          title: current?.title ?? beforeState.title ?? "",
          summary: current?.summary ?? null,
          body_md: current?.body_md ?? "",
          status: "archived",
          category_id: current?.category_id ?? null,
        };
        break;
      default:
        throw new Error("Unsupported KB tool");
    }

    return { kind, tool: act.tool, article_id: articleId, scope, current, proposed };
  });
