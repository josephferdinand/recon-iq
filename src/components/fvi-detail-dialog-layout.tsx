import type { ReactNode } from "react";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";

export type FviDetailDialogField = { label: string; value: ReactNode };

type Props = {
  railEyebrow: string;
  railTitle: string;
  railStatus: ReactNode;
  railFields: FviDetailDialogField[];
  title: string;
  description: string;
  content: ReactNode;
  actions: ReactNode;
};

export function FviDetailDialogLayout({
  railEyebrow,
  railTitle,
  railStatus,
  railFields,
  title,
  description,
  content,
  actions,
}: Props) {
  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] sm:grid-cols-[minmax(17rem,27%)_minmax(0,1fr)] sm:grid-rows-[minmax(0,1fr)_auto]">
      <aside aria-label={`${railEyebrow} ${railTitle} summary`} className="flex max-h-[34dvh] min-h-0 flex-col overflow-y-auto bg-[var(--ink-2)] px-5 py-5 text-[var(--fvi-text-100)] sm:max-h-none sm:px-7 sm:py-8">
        <div className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--fvi-text-70)]">{railEyebrow}</div>
        <h3 className="mt-1 text-2xl font-semibold uppercase leading-tight tracking-wide">{railTitle}</h3>
        <div className="mt-5 h-px bg-[var(--fvi-gold)]" aria-hidden="true" />
        <div className="mt-5 self-start">{railStatus}</div>
        <dl className="mt-5 space-y-4 text-sm">
          {railFields.map((field) => (
            <div key={field.label}>
              <dt className="text-xs text-[var(--fvi-text-70)]">{field.label}</dt>
              <dd className="mt-1 break-words">{field.value}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-5 h-px bg-[var(--fvi-gold)]" aria-hidden="true" />
      </aside>

      <main className="flex min-h-0 flex-col overflow-hidden bg-background px-5 py-6 text-foreground sm:px-8 sm:py-10">
        <header className="shrink-0 border-b border-border pb-5 pr-8 sm:pb-7">
          <DialogTitle data-fvi-dialog-title tabIndex={-1} className="text-xl font-semibold leading-tight text-foreground sm:text-3xl">{title}</DialogTitle>
          <DialogDescription className="mt-3 max-w-4xl text-sm sm:text-base">{description}</DialogDescription>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto pt-5 sm:pt-8">{content}</div>
      </main>

      <footer className="col-span-full border-t bg-background px-4 py-3 sm:px-8 sm:py-4">
        <div className="flex flex-wrap justify-end gap-2 sm:gap-3">{actions}</div>
      </footer>
    </div>
  );
}
