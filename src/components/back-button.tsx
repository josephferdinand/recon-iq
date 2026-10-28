import { Link, useRouter } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

interface BackButtonProps {
  /** Fallback destination when there's no browser history to go back to. Default "/". */
  fallbackTo?: string;
  /** Optional label override. Default "Back". */
  label?: string;
  className?: string;
}

/**
 * Enterprise-grade Back button.
 * - Uses browser history when available (native "back" behaviour).
 * - Falls back to a real <Link> to a safe destination so it's still
 *   keyboard-friendly, right-clickable and crawlable.
 */
export function BackButton({ fallbackTo = "/", label = "Back", className = "" }: BackButtonProps) {
  const router = useRouter();

  const base =
    "inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/60 px-3 py-1.5 text-xs font-medium text-foreground transition hover:border-border hover:bg-muted hover:text-foreground";

  return (
    <Link
      to={fallbackTo}
      className={`${base} ${className}`}
      aria-label={label}
      onClick={(event) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        if (window.history.length > 1) {
          event.preventDefault();
          router.history.back();
        }
      }}
    >
      <ArrowLeft className="h-3.5 w-3.5" />
      {label}
    </Link>
  );
}
