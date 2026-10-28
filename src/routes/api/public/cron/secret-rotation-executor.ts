// Secret rotation executor (Batch 2 · tenant admin follow-up).
// Called by pg_cron every hour. Iterates active rotation policies across all
// tenants, reschedules from observed rotations, and creates advisory
// notifications for tenant admins when policies are overdue.
import { createFileRoute } from "@tanstack/react-router";
import { verifyCronSecret } from "@/lib/cron-auth.server";

export const Route = createFileRoute("/api/public/cron/secret-rotation-executor")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauth = verifyCronSecret(request);
        if (unauth) return unauth;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const nowIso = new Date().toISOString();
        const nowMs = Date.now();

        const { data: policies, error } = await supabaseAdmin
          .from("secret_rotation_policies" as never)
          .select("id,tenant_id,secret_id,category,provider,rotation_interval_days,last_rotation_at,next_rotation_at,auto_rotate")
          .eq("is_active", true);
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

        let overdue = 0;
        let rescheduled = 0;
        let notified = 0;

        for (const p of (policies ?? []) as any[]) {
          const interval = (p.rotation_interval_days ?? 90) * 86_400_000;

          // Detect newer secret version → reschedule.
          if (p.secret_id) {
            const { data: ver } = await supabaseAdmin
              .from("app_vault_secret_versions" as never)
              .select("created_at,version")
              .eq("secret_id", p.secret_id)
              .order("version", { ascending: false })
              .limit(1)
              .maybeSingle();
            const latest = (ver as any)?.created_at ? new Date((ver as any).created_at).getTime() : null;
            if (
              latest &&
              (!p.last_rotation_at || latest > new Date(p.last_rotation_at).getTime())
            ) {
              await supabaseAdmin
                .from("secret_rotation_policies" as never)
                .update({
                  last_rotation_at: new Date(latest).toISOString(),
                  next_rotation_at: new Date(latest + interval).toISOString(),
                } as never)
                .eq("id", p.id);
              rescheduled += 1;
              continue;
            }
          }

          const dueMs = p.next_rotation_at ? new Date(p.next_rotation_at).getTime() : nowMs;
          if (dueMs > nowMs) continue;
          overdue += 1;

          const { data: admins } = await supabaseAdmin
            .from("tenant_members" as never)
            .select("user_id")
            .eq("tenant_id", p.tenant_id)
            .eq("role", "tenant_admin");
          for (const a of (admins ?? []) as any[]) {
            await supabaseAdmin.from("notifications" as never).insert({
              user_id: a.user_id,
              tenant_id: p.tenant_id,
              kind: "secret.rotation.overdue",
              severity: "warning",
              title: "Secret rotation overdue",
              body: `Rotation policy "${p.category ?? p.provider ?? "secret"}" past due (auto_rotate=${p.auto_rotate}).`,
              context: { policy_id: p.id, secret_id: p.secret_id, due_at: p.next_rotation_at, scanned_at: nowIso },
            } as never);
            notified += 1;
          }
        }
        return Response.json({ ok: true, scanned: policies?.length ?? 0, overdue, rescheduled, notified });
      },
    },
  },
});
