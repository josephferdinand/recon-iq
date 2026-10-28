import { toast } from "sonner";
import { reportPlatformError } from "./error-reporting";
import { USER_FACING_ERRORS, userFacingErrorKind } from "./user-facing-errors";

/** Safe to import during SSR; UI callers invoke this from client event handlers. */
export function notifyUserError(error: unknown, surface: string): void {
  const kind = userFacingErrorKind(error);
  const copy = USER_FACING_ERRORS[kind];
  reportPlatformError(error, { source: "user_feedback", surface, kind });
  toast.error(copy.title, { description: `${copy.message} ${copy.action}` });
}
