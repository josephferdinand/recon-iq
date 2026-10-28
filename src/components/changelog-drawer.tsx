import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles } from "lucide-react";

interface Entry { date: string; title: string; tag: "new" | "improved" | "fixed"; body: string; }

const ENTRIES: Entry[] = [
  { date: "2026-06-27", tag: "new", title: "Notification center", body: "Bell in the header surfaces recon runs, escalations, and security events." },
  { date: "2026-06-27", tag: "new", title: "Saved views", body: "Save and share filter presets in the Exceptions inbox." },
  { date: "2026-06-27", tag: "new", title: "Bulk triage + escalate", body: "Select multiple breaks, resolve/won't-fix at once. Press 'e' to escalate to a ticket." },
  { date: "2026-06-27", tag: "improved", title: "First-run onboarding", body: "A guided checklist tracks data source → upload → recon → run." },
  { date: "2026-06-27", tag: "improved", title: "Skeleton loaders + optimistic UI", body: "Tabs now render placeholders instead of blank space." },
  { date: "2026-06-27", tag: "improved", title: "Confirmation modals", body: "Destructive actions now open AlertDialog instead of native confirm()." },
  { date: "2026-06-26", tag: "new", title: "PII redaction + GDPR exports", body: "Copilot prompts are redacted before send. Users can export and request erasure." },
  { date: "2026-06-26", tag: "new", title: "Command palette ⌘K", body: "Jump anywhere from anywhere." },
];

const LS_KEY = "fvi.changelog.lastSeen";

export function ChangelogDrawer() {
  const latest = ENTRIES[0]?.date ?? "";
  const [hasNew, setHasNew] = useState(false);

  useEffect(() => {
    const last = typeof window !== "undefined" ? localStorage.getItem(LS_KEY) : null;
    setHasNew(!!latest && last !== latest);
  }, [latest]);

  return (
    <Sheet onOpenChange={(o) => { if (o && latest) { localStorage.setItem(LS_KEY, latest); setHasNew(false); } }}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="What's new" className="relative">
          <Sparkles className="h-4 w-4" />
          {hasNew && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-primary" />}
        </Button>
      </SheetTrigger>
      <SheetContent className="w-[420px] sm:max-w-[420px]">
        <SheetHeader>
          <SheetTitle>What's new</SheetTitle>
          <SheetDescription>Recent changes to ReconIQ.</SheetDescription>
        </SheetHeader>
        <div className="mt-6 space-y-4 overflow-y-auto pr-2" style={{ maxHeight: "calc(100dvh - 140px)" }}>
          {ENTRIES.map((e, i) => (
            <div key={i} className="rounded-lg border bg-card p-3">
              <div className="flex items-center gap-2">
                <Badge variant={e.tag === "new" ? "default" : e.tag === "fixed" ? "destructive" : "secondary"} className="text-[10px] uppercase">{e.tag}</Badge>
                <span className="text-xs text-muted-foreground">{e.date}</span>
              </div>
              <h4 className="mt-1.5 text-sm font-medium">{e.title}</h4>
              <p className="mt-0.5 text-xs text-muted-foreground">{e.body}</p>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
