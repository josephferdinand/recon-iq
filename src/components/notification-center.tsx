import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Bell, Check } from "lucide-react";
import { listNotifications, markNotificationRead } from "@/lib/notifications.functions";

export function NotificationCenter() {
  const qc = useQueryClient();
  const list = useServerFn(listNotifications);
  const mark = useServerFn(markNotificationRead);

  const q = useQuery({
    queryKey: ["notifications"],
    queryFn: () => list({ data: {} }),
    refetchInterval: 60_000,
    staleTime: 45_000,
    gcTime: 5 * 60_000,
  });

  const items = q.data ?? [];
  const unread = items.filter((n: any) => !n.read_at).length;

  const mMark = useMutation({
    mutationFn: (vars: { id?: string }) => mark({ data: vars }),
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: ["notifications"] });
      const prev = qc.getQueryData<any[]>(["notifications"]);
      qc.setQueryData<any[]>(["notifications"], (old) =>
        (old ?? []).map((n) =>
          !vars.id || n.id === vars.id
            ? { ...n, read_at: n.read_at ?? new Date().toISOString() }
            : n,
        ),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["notifications"], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
          className="relative"
        >
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[9px] font-bold text-destructive-foreground">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="max-h-[var(--radix-popover-content-available-height)] w-[min(28rem,calc(100dvw-1rem))] max-w-[calc(100dvw-1rem)] overflow-hidden p-0"
        align="end"
        sideOffset={8}
        collisionPadding={8}
        aria-label="Notifications"
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
          <div className="text-sm font-medium">Notifications</div>
          {unread > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => mMark.mutate({})}
            >
              <Check className="mr-1 h-3 w-3" /> Mark all read
            </Button>
          )}
        </div>
        <div
          role="region"
          aria-label="Notification history"
          tabIndex={0}
          className="max-h-[min(24rem,calc(var(--radix-popover-content-available-height)_-_3.25rem))] min-h-0 w-full overflow-x-hidden overflow-y-auto overscroll-contain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          {q.isLoading ? (
            <div className="space-y-2 p-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : items.length === 0 ? (
            <div className="p-6 text-center text-xs text-muted-foreground">
              You're all caught up.
            </div>
          ) : (
            <ul className="min-w-0 divide-y overflow-hidden">
              {items.map((n: any) => (
                <li
                  key={n.id}
                  className={`w-full min-w-0 cursor-pointer overflow-hidden p-3 text-sm hover:bg-muted/50 ${n.read_at ? "opacity-60" : ""}`}
                  onClick={() => {
                    if (!n.read_at) mMark.mutate({ id: n.id });
                    if (n.link_to) window.location.assign(n.link_to);
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-start gap-2">
                        <Badge
                          variant={sevVariant(n.severity)}
                          className="mt-0.5 shrink-0 text-[10px]"
                        >
                          {n.severity}
                        </Badge>
                        <span className="min-w-0 flex-1 whitespace-normal break-words font-medium leading-5 [overflow-wrap:anywhere]">
                          {n.title}
                        </span>
                      </div>
                      {n.body && (
                        <p className="mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">
                          {n.body}
                        </p>
                      )}
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {new Date(n.created_at).toLocaleString()}
                      </p>
                    </div>
                    {!n.read_at && (
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function sevVariant(s: string): any {
  if (s === "critical") return "destructive";
  if (s === "warning") return "outline";
  if (s === "success") return "default";
  return "secondary";
}
