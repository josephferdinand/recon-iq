import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator,
} from "@/components/ui/command";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { globalSearch, type SearchHit } from "@/lib/search.functions";
import { Home, Briefcase, Settings, ShieldCheck, LogOut, LifeBuoy, BookOpen, MessageSquare, GitBranch, ShieldAlert, Database, FileText, DatabaseBackup } from "lucide-react";

interface Ctx { tenantSlug?: string; tenantId?: string }

export function CommandPalette({ ctx }: { ctx?: Ctx } = {}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const navigate = useNavigate();
  const search = useServerFn(globalSearch);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open || query.trim().length < 2) { setHits([]); return; }
    const id = setTimeout(async () => {
      try {
        const r = await search({ data: { q: query.trim(), tenant_id: ctx?.tenantId } });
        setHits(r);
      } catch { setHits([]); }
    }, 220);
    return () => clearTimeout(id);
  }, [query, open, ctx?.tenantId, search]);

  const go = (fn: () => void) => { setOpen(false); fn(); };
  const slug = ctx?.tenantSlug;

  function jumpToHit(h: SearchHit) {
    if (!slug) return;
    const tab =
      h.kind === "recon" ? "recons" :
      h.kind === "exception" ? "exceptions" :
      h.kind === "ticket" ? "tickets" :
      h.kind === "kb" ? "kb" :
      "data";
    if (h.kind === "kb") navigate({ to: "/$slug/tenant", params: { slug }, hash: "kb" });
    else navigate({ to: "/$slug/workspace", params: { slug }, hash: tab });
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search ReconIQ — ReconIQ Studio, breaks, tickets, KB…" value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>{query.trim().length < 2 ? "Type at least 2 characters." : "No matches."}</CommandEmpty>

        {hits.length > 0 && (
          <CommandGroup heading="Results">
            {hits.map((h) => (
              <CommandItem key={`${h.kind}-${h.id}`} onSelect={() => go(() => jumpToHit(h))}>
                <KindIcon kind={h.kind} />
                <span className="truncate">{h.title}</span>
                {h.subtitle ? <span className="ml-2 truncate text-xs text-muted-foreground">{h.subtitle}</span> : null}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandSeparator />
        <CommandGroup heading="Navigate">
          <CommandItem onSelect={() => go(() => navigate({ to: "/home" }))}><Home className="mr-2 h-4 w-4" /> Home</CommandItem>
          <CommandItem onSelect={() => go(() => navigate({ to: "/platform" }))}><ShieldCheck className="mr-2 h-4 w-4" /> Platform admin</CommandItem>
          <CommandItem onSelect={() => go(() => navigate({ to: "/platform-backup" }))}><DatabaseBackup className="mr-2 h-4 w-4" /> Platform · Backup & recovery</CommandItem>
          {slug ? (
            <>
              <CommandItem onSelect={() => go(() => navigate({ to: "/$slug/workspace", params: { slug } }))}><Briefcase className="mr-2 h-4 w-4" /> Workspace</CommandItem>
              <CommandItem onSelect={() => go(() => navigate({ to: "/$slug/tenant", params: { slug } }))}><Settings className="mr-2 h-4 w-4" /> Tenant management</CommandItem>
            </>
          ) : null}
        </CommandGroup>

        {slug ? (
          <>
            <CommandSeparator />
            <CommandGroup heading={`${slug} — jump`}>
              <CommandItem onSelect={() => go(() => navigate({ to: "/$slug/tenant", params: { slug }, hash: "members" }))}><Settings className="mr-2 h-4 w-4" /> Members</CommandItem>
              <CommandItem onSelect={() => go(() => navigate({ to: "/$slug/tenant", params: { slug }, hash: "kb" }))}><BookOpen className="mr-2 h-4 w-4" /> Knowledge base</CommandItem>
              <CommandItem onSelect={() => go(() => navigate({ to: "/$slug/tenant", params: { slug }, hash: "tickets" }))}><LifeBuoy className="mr-2 h-4 w-4" /> Tickets</CommandItem>
              <CommandItem onSelect={() => go(() => navigate({ to: "/$slug/tenant", params: { slug }, hash: "copilot" }))}><MessageSquare className="mr-2 h-4 w-4" /> Copilot</CommandItem>
            </CommandGroup>
          </>
        ) : null}

        <CommandSeparator />
        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => go(async () => { const { reportAuthEvent } = await import("@/lib/auth-audit"); reportAuthEvent("auth.logout", { context: { source: "command_palette" } }); await supabase.auth.signOut(); navigate({ to: "/auth" }); })}>
            <LogOut className="mr-2 h-4 w-4" /> Sign out
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

function KindIcon({ kind }: { kind: SearchHit["kind"] }) {
  const cls = "mr-2 h-4 w-4";
  if (kind === "recon") return <GitBranch className={cls} />;
  if (kind === "exception") return <ShieldAlert className={cls} />;
  if (kind === "ticket") return <LifeBuoy className={cls} />;
  if (kind === "kb") return <FileText className={cls} />;
  return <Database className={cls} />;
}
