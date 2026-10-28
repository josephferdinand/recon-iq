import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LogOut, User as UserIcon, Settings, IdCard } from "lucide-react";
import { reportAuthEvent } from "@/lib/auth-audit";

export function UserProfileMenu() {
  const navigate = useNavigate();

  const q = useQuery({
    queryKey: ["me-profile"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      const { data: p } = await supabase
        .from("profiles")
        .select("full_name, avatar_url, email")
        .eq("id", u.user.id)
        .maybeSingle();
      return {
        id: u.user.id,
        email: p?.email ?? u.user.email ?? "",
        full_name: p?.full_name ?? "",
        avatar_url: p?.avatar_url ?? "",
      };
    },
    staleTime: 5 * 60 * 1000,
  });

  const me = q.data;
  const initials = (me?.full_name || me?.email || "?")
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");

  const signOut = async () => {
    reportAuthEvent("auth.logout", { context: { source: "user_menu" } });
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full" aria-label="Account menu">
          <Avatar className="h-8 w-8">
            {me?.avatar_url ? <AvatarImage src={me.avatar_url} alt="" /> : null}
            <AvatarFallback className="bg-primary text-primary-foreground text-xs font-semibold">
              {initials || <UserIcon className="h-4 w-4" />}
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>
          <div className="flex items-center gap-3">
            <Avatar className="h-10 w-10">
              {me?.avatar_url ? <AvatarImage src={me.avatar_url} alt="" /> : null}
              <AvatarFallback className="bg-primary text-primary-foreground">{initials}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{me?.full_name || "User"}</div>
              <div className="truncate text-xs font-normal text-muted-foreground">{me?.email}</div>
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate({ to: "/home" })}>
          <UserIcon className="mr-2 h-4 w-4" /> Home
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate({ to: "/profile" })}>
          <IdCard className="mr-2 h-4 w-4" /> Profile
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate({ to: "/billing" })}>
          <Settings className="mr-2 h-4 w-4" /> Billing & plan
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={signOut} className="text-destructive focus:text-destructive">
          <LogOut className="mr-2 h-4 w-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
