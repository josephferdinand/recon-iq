/**
 * DeprecatedBanner — visible in-UI notice for surfaces slated for retirement.
 * Renders a warning-styled alert at the top of a legacy tab/page pointing to
 * the successor surface. Uses semantic tokens only.
 */
import { AlertTriangle, ArrowRight } from "lucide-react";
import { Link } from "@tanstack/react-router";

export function DeprecatedBanner({
  successorLabel,
  successorHref,
  note,
}: {
  successorLabel: string;
  successorHref: string;
  note?: string;
}) {
  return (
    <div
      role="status"
      className="mb-4 flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-foreground"
    >
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
      <div className="flex-1">
        <p className="font-medium">
          Deprecated surface — scheduled for removal in the next rationalization wave.
        </p>
        {note ? <p className="mt-1 text-muted-foreground">{note}</p> : null}
        <Link
          to={successorHref}
          className="mt-2 inline-flex items-center gap-1 font-medium text-primary hover:underline"
        >
          Move to {successorLabel} <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}
