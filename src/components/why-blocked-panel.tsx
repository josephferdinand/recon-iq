/**
 * WhyBlockedPanel — enterprise "why can't I do this?" explainer.
 *
 * Wire next to any disabled action, blocked API surface, or last-error state.
 * Renders the full entitlement decision chain returned by `explainAccess`:
 * platform grant → tenant scope → group override → feature dependency →
 * recent denies. All layer detail is surfaced verbatim so support can
 * screenshot and file a role/flag request.
 *
 * Usage:
 *   <WhyBlockedPanel
 *     fnName="tenant.security.update"
 *     tenantId={tenantId}
 *     featureKey="security.write"
 *   />
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { HelpCircle, ShieldCheck, ShieldAlert, ShieldQuestion, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from "@/components/ui/sheet";
import { explainAccess, type AccessExplanation, type LayerStatus } from "@/lib/access-explain.functions";
import { cn } from "@/lib/utils";

type Props = {
  fnName: string;
  tenantId?: string | null;
  featureKey?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  /** Visual style of the trigger. Default "ghost-icon". */
  variant?: "ghost-icon" | "link" | "outline";
  /** Optional trigger label (defaults to icon-only when ghost-icon). */
  label?: string;
  className?: string;
};

function statusTone(status: LayerStatus) {
  switch (status) {
    case "allow":
      return {
        badge: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
        icon: <ShieldCheck className="h-4 w-4 text-emerald-500" aria-hidden />,
      };
    case "deny":
      return {
        badge: "bg-destructive/15 text-destructive border-destructive/30",
        icon: <ShieldAlert className="h-4 w-4 text-destructive" aria-hidden />,
      };
    case "skipped":
      return {
        badge: "bg-muted text-muted-foreground border-border",
        icon: <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />,
      };
    default:
      return {
        badge: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
        icon: <ShieldQuestion className="h-4 w-4 text-amber-500" aria-hidden />,
      };
  }
}

export function WhyBlockedPanel({
  fnName,
  tenantId,
  featureKey,
  resourceType,
  resourceId,
  variant = "ghost-icon",
  label,
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const explainFn = useServerFn(explainAccess);
  const mutation = useMutation({
    mutationFn: async () =>
      explainFn({
        data: {
          fn_name: fnName,
          tenant_id: tenantId ?? null,
          feature_key: featureKey ?? null,
          resource_type: resourceType ?? null,
          resource_id: resourceId ?? null,
        },
      }) as Promise<AccessExplanation>,
  });

  const onOpen = (v: boolean) => {
    setOpen(v);
    if (v && !mutation.data && !mutation.isPending) mutation.mutate();
  };

  const trigger =
    variant === "ghost-icon" ? (
      <Button
        variant="ghost"
        size="sm"
        className={cn("h-7 gap-1.5 px-2 text-muted-foreground hover:text-foreground", className)}
        aria-label="Why is this blocked?"
      >
        <HelpCircle className="h-3.5 w-3.5" aria-hidden />
        {label ?? "Why?"}
      </Button>
    ) : (
      <Button variant={variant === "link" ? "link" : "outline"} size="sm" className={className}>
        <HelpCircle className="mr-1.5 h-3.5 w-3.5" aria-hidden />
        {label ?? "Why blocked?"}
      </Button>
    );

  const exp = mutation.data;

  return (
    <Sheet open={open} onOpenChange={onOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto bg-background text-foreground">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {exp?.decision === "allow" ? (
              <ShieldCheck className="h-5 w-5 text-emerald-500" aria-hidden />
            ) : exp?.decision === "deny" ? (
              <ShieldAlert className="h-5 w-5 text-destructive" aria-hidden />
            ) : (
              <ShieldQuestion className="h-5 w-5 text-amber-500" aria-hidden />
            )}
            Access explanation
          </SheetTitle>
          <SheetDescription className="text-xs">
            <code className="rounded bg-muted px-1.5 py-0.5">{fnName}</code>
            {tenantId ? (
              <>
                {" · tenant "}
                <code className="rounded bg-muted px-1.5 py-0.5">{tenantId.slice(0, 8)}…</code>
              </>
            ) : null}
            {featureKey ? (
              <>
                {" · feature "}
                <code className="rounded bg-muted px-1.5 py-0.5">{featureKey}</code>
              </>
            ) : null}
          </SheetDescription>
        </SheetHeader>

        {mutation.isPending && (
          <p className="mt-6 text-sm text-muted-foreground">Evaluating entitlement chain…</p>
        )}
        {mutation.isError && (
          <p className="mt-6 text-sm text-destructive">
            Could not evaluate: {String((mutation.error as Error)?.message ?? mutation.error)}
          </p>
        )}

        {exp && (
          <div className="mt-6 space-y-4">
            <div className="rounded-md border border-border bg-muted/40 p-3">
              <p className="text-sm font-medium">
                Decision:{" "}
                <span
                  className={cn(
                    "font-semibold uppercase tracking-wide",
                    exp.decision === "allow" && "text-emerald-600 dark:text-emerald-400",
                    exp.decision === "deny" && "text-destructive",
                    exp.decision === "unknown" && "text-amber-600 dark:text-amber-400",
                  )}
                >
                  {exp.decision}
                </span>
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{exp.summary}</p>
            </div>

            <ol className="space-y-3">
              {exp.layers.map((layer, i) => {
                const tone = statusTone(layer.status);
                return (
                  <li
                    key={layer.key}
                    className="rounded-md border border-border bg-background p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-muted-foreground">{i + 1}.</span>
                        {tone.icon}
                        <span className="text-sm font-medium">{layer.label}</span>
                      </div>
                      <Badge variant="outline" className={cn("uppercase text-[10px]", tone.badge)}>
                        {layer.status}
                      </Badge>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{layer.summary}</p>
                    {layer.detail && Object.keys(layer.detail).length > 0 && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                          Detail
                        </summary>
                        <pre className="mt-2 max-h-48 overflow-auto rounded bg-muted p-2 text-[11px] leading-tight text-foreground">
                          {JSON.stringify(layer.detail, null, 2)}
                        </pre>
                      </details>
                    )}
                  </li>
                );
              })}
            </ol>

            <p className="pt-2 text-[11px] text-muted-foreground">
              Evaluated {new Date(exp.evaluated_at).toLocaleString()} · all
              reads run under your session (RLS-bound).
            </p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default WhyBlockedPanel;
