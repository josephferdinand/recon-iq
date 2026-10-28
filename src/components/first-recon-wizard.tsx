import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, Circle, Clock, Database, GitBranch, Library, Play, Rocket, Sparkles, UploadCloud } from "lucide-react";

interface Props {
  tenantSlug: string;
  /** Triggering element. Defaults to a small primary button. */
  trigger?: React.ReactNode;
}

interface Step {
  key: string;
  title: string;
  detail: string;
  icon: typeof Database;
  etaMin: number;
  to: string;
  cta: string;
}

/**
 * "First recon in <30 min" guided wizard.
 *
 * Renders a 5-step launcher that walks customers through the fastest path from
 * an empty workspace to a green reconciliation: clone an accelerator → upload
 * sample data → author rules → run → review breaks. Each step deep-links into
 * the relevant workspace page and ticks itself when revisited.
 */
export function FirstReconWizard({ tenantSlug, trigger }: Props) {
  const storageKey = `fvi.first-recon.${tenantSlug}`;
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [startedAt, setStartedAt] = useState<number | null>(null);

  // Hydrate from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        setDone(parsed.done ?? {});
        setStartedAt(parsed.startedAt ?? null);
      }
    } catch { /* ignore */ }
  }, [storageKey]);

  // Persist
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify({ done, startedAt })); } catch { /* ignore */ }
  }, [storageKey, done, startedAt]);

  const steps: Step[] = [
    { key: "library",   title: "Clone an accelerator",    detail: "Pick from 57 pre-built recons — Nostro, Custody, Card Scheme, Crypto, Insurance and more.", icon: Library,      etaMin: 3,  to: `/${tenantSlug}/tenant?page=process-library`, cta: "Open Library" },
    { key: "upload",    title: "Upload sample data",      detail: "Drop a CSV or JSON. We auto-detect the schema, hash the file, and map columns.",         icon: UploadCloud,  etaMin: 5,  to: `/${tenantSlug}/workspace?page=data`,             cta: "Upload files" },
    { key: "rules",     title: "Author matching rules",   detail: "Use the Natural Rule Language or pick a tolerance ladder. Cascade passes ready to go.",  icon: GitBranch,    etaMin: 10, to: `/${tenantSlug}/workspace?page=recons`,           cta: "Open ReconIQ Studio" },
    { key: "run",       title: "Run the reconciliation", detail: "Trigger the first run. Matches and breaks land in the inbox within seconds.",            icon: Play,         etaMin: 5,  to: `/${tenantSlug}/workspace?page=runs`,             cta: "Run now" },
    { key: "review",    title: "Triage the breaks",       detail: "Use Copilot, predicted root cause, and bulk resolution to clear exceptions.",            icon: Sparkles,     etaMin: 7,  to: `/${tenantSlug}/workspace?page=exceptions`,       cta: "Open Exceptions" },
  ];

  const completed = steps.filter((s) => done[s.key]).length;
  const pct = Math.round((completed / steps.length) * 100);
  const elapsedMin = startedAt ? Math.floor((Date.now() - startedAt) / 60_000) : 0;
  const remainingEta = steps.filter((s) => !done[s.key]).reduce((sum, s) => sum + s.etaMin, 0);

  const toggle = (key: string) => {
    if (!startedAt) setStartedAt(Date.now());
    setDone((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm" variant="default">
            <Rocket className="mr-2 h-4 w-4" /> Build first recon · 30 min
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Rocket className="h-4 w-4 text-primary" /> First reconciliation in &lt; 30 minutes
          </DialogTitle>
          <DialogDescription>
            A guided launcher that takes you from zero to a green reconciliation. Tick each step as you complete it.
          </DialogDescription>
        </DialogHeader>

        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="flex items-center justify-between gap-4 p-4">
            <div className="flex-1">
              <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>{completed} of {steps.length} complete</span>
                <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> ETA {remainingEta} min · elapsed {elapsedMin} min</span>
              </div>
              <Progress value={pct} />
            </div>
            <Badge variant={completed === steps.length ? "default" : "outline"}>{pct}%</Badge>
          </CardContent>
        </Card>

        <ol className="space-y-2">
          {steps.map((s, idx) => {
            const isDone = !!done[s.key];
            const Icon = s.icon;
            return (
              <li key={s.key} className="flex items-start gap-3 rounded-md border bg-background p-3">
                <button
                  type="button"
                  aria-label={isDone ? "Mark step incomplete" : "Mark step complete"}
                  onClick={() => toggle(s.key)}
                  className="mt-0.5"
                >
                  {isDone
                    ? <CheckCircle2 className="h-5 w-5 text-primary" />
                    : <Circle className="h-5 w-5 text-muted-foreground" />}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-sm font-medium ${isDone ? "line-through opacity-60" : ""}`}>
                      Step {idx + 1}. {s.title}
                    </span>
                    <Badge variant="outline" className="text-[10px]">{s.etaMin} min</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{s.detail}</p>
                </div>
                <Button asChild size="sm" variant={isDone ? "ghost" : "outline"}>
                  <Link to={s.to} onClick={() => setOpen(false)}>
                    <Icon className="mr-1.5 h-3.5 w-3.5" /> {s.cta}
                  </Link>
                </Button>
              </li>
            );
          })}
        </ol>

        <DialogFooter className="flex items-center justify-between sm:justify-between">
          <Button variant="ghost" size="sm" onClick={() => { setDone({}); setStartedAt(null); }}>
            Reset progress
          </Button>
          <Button size="sm" onClick={() => setOpen(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
