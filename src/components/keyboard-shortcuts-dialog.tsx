import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { formatCombo, type Shortcut } from "@/hooks/use-keyboard-shortcuts";
import { Keyboard } from "lucide-react";

export function KeyboardShortcutsDialog({
  open,
  onOpenChange,
  shortcuts,
  title = "Keyboard shortcuts",
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  shortcuts: Shortcut[];
  title?: string;
}) {
  const groups = new Map<string, Shortcut[]>();
  for (const sc of shortcuts) {
    const g = sc.group ?? "General";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(sc);
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh_-_1rem)] w-[calc(100vw_-_1rem)] max-w-[42rem] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-h-[calc(100dvh_-_2rem)]">
        <DialogHeader className="shrink-0 border-b px-4 py-4 pr-12 text-left sm:px-6 sm:pr-12">
          <DialogTitle className="flex min-w-0 items-start gap-2 leading-snug">
            <Keyboard className="mt-0.5 h-5 w-5 shrink-0" />
            <span className="min-w-0 break-words">{title}</span>
          </DialogTitle>
          <DialogDescription>
            Press <kbd className="rounded border bg-muted px-1.5 py-0.5 text-xs">?</kbd> any time to show this dialog.
          </DialogDescription>
        </DialogHeader>
        <div
          role="region"
          aria-label={`${title} list`}
          tabIndex={0}
          className="min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain px-4 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-6"
        >
          <div className="space-y-5">
            {[...groups.entries()].map(([group, items]) => (
              <div key={group}>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group}</div>
                <div className="divide-y rounded-md border">
                  {items.map((sc) => (
                    <div key={sc.combo + sc.description} className="flex items-center justify-between gap-4 px-3 py-2 text-sm">
                      <span className="min-w-0 break-words">{sc.description}</span>
                      <kbd className="shrink-0 rounded border bg-muted px-2 py-0.5 font-mono text-xs">{formatCombo(sc.combo)}</kbd>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
