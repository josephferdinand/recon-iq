import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { USER_FACING_ERRORS, userFacingErrorKind } from "@/lib/user-facing-errors";

function safeErrorKind(error: unknown): keyof typeof USER_FACING_ERRORS {
  const initial = userFacingErrorKind(error);
  if (initial !== "unexpected") return initial;

  const detail = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const message = typeof detail.message === "string" ? detail.message : "";
  if (/\b42501\b|permission denied|not authorized|\bforbidden\b/i.test(message)) return "access";
  if (/\bPGRST00[23]\b|\bservice unavailable\b/i.test(message)) return "service";
  if (/\barticle not found\b|\brecord not found\b/i.test(message)) return "record";
  return "unexpected";
}

export function QueryErrorFeedback({
  error,
  onRetry,
  resource,
}: {
  error: unknown;
  onRetry: () => unknown;
  resource: string;
}) {
  const copy = USER_FACING_ERRORS[safeErrorKind(error)];

  return (
    <Alert variant="destructive" className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <AlertTitle>{copy.title}</AlertTitle>
        <AlertDescription>
          <p>{resource} could not be loaded. {copy.message}</p>
          <p className="mt-1">{copy.action}</p>
        </AlertDescription>
      </div>
      <Button type="button" variant="outline" onClick={() => { void onRetry(); }}>
        Retry
      </Button>
    </Alert>
  );
}

/** Maps known approval conflicts to reviewed copy and never displays raw errors. */
export function safeActionErrorMessage(error: unknown): string {
  const message = error && typeof error === "object" && "message" in error
    ? String((error as { message?: unknown }).message ?? "")
    : "";

  if (/maker cannot approve own manual match/i.test(message)) {
    return "A different authorized reviewer must approve this match.";
  }
  if (/preparer cannot approve their own EOD sign-off/i.test(message)) {
    return "A different authorized reviewer must approve this sign-off.";
  }

  const copy = USER_FACING_ERRORS[safeErrorKind(error)];
  return `${copy.title}. ${copy.action}`;
}
