import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { heartbeatPresence, leavePresence, listPresence } from "@/lib/presence.functions";
import { supabase } from "@/integrations/supabase/client";

type Viewer = { user_id: string; last_seen_at: string; profiles?: { full_name?: string; email?: string; avatar_url?: string } };

export function PresenceBar({ tenantId, resourceType, resourceId }: {
  tenantId: string; resourceType: string; resourceId: string;
}) {
  const beat = useServerFn(heartbeatPresence);
  const leave = useServerFn(leavePresence);
  const list = useServerFn(listPresence);
  const [viewers, setViewers] = useState<Viewer[]>([]);

  useEffect(() => {
    let mounted = true;
    const tick = async () => {
      try {
        await beat({ data: { tenant_id: tenantId, resource_type: resourceType, resource_id: resourceId } });
        const v = await list({ data: { tenant_id: tenantId, resource_type: resourceType, resource_id: resourceId } });
        if (mounted) setViewers(v as Viewer[]);
      } catch { /* ignore */ }
    };
    tick();
    const id = setInterval(tick, 15_000);
    const ch = supabase
      .channel(`presence:${resourceType}:${resourceId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "recon_presence", filter: `resource_id=eq.${resourceId}` }, () => tick())
      .subscribe();
    return () => {
      mounted = false;
      clearInterval(id);
      supabase.removeChannel(ch);
      leave({ data: { resource_type: resourceType, resource_id: resourceId } }).catch(() => null);
    };
  }, [tenantId, resourceType, resourceId, beat, leave, list]);

  if (viewers.length <= 1) return null;
  return (
    <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-1.5">
      <div className="flex -space-x-2">
        {viewers.slice(0, 5).map((v) => (
          <div key={v.user_id}
            title={v.profiles?.full_name ?? v.profiles?.email ?? v.user_id}
            className="grid h-6 w-6 place-items-center rounded-full border-2 border-background bg-primary text-[10px] font-semibold text-primary-foreground">
            {(v.profiles?.full_name ?? v.profiles?.email ?? "?").slice(0, 2).toUpperCase()}
          </div>
        ))}
      </div>
      <span className="text-xs text-muted-foreground">{viewers.length} viewing now</span>
    </div>
  );
}
