/**
 * Safe, context-aware message formatting for module consumers.
 *
 * Callers provide a reviewed action label and only facts they have verified.
 * Raw exceptions, response bodies, SQL, and provider details are never inputs.
 */
export type UserMessageCategory =
  | "input"
  | "business"
  | "auth"
  | "session"
  | "mfa"
  | "network"
  | "timeout"
  | "dependency"
  | "system"
  | "unknown_write_outcome";

export type BusinessReason =
  | "duplicate"
  | "not_found"
  | "invalid_transition"
  | "missing_dependency"
  | "limit_exceeded"
  | "unsupported_value";

export type FieldIssue = {
  field: string;
  issue: "required" | "invalid_format" | "unsupported_value" | "too_long" | "too_large";
  /** Exact limit from the owning field or API contract. */
  limit?: number;
  /** Exact supported values from the owning field or API contract. */
  allowedValues?: readonly string[];
};

export type AvailableUserAction = {
  /** Stable caller-owned action key used to connect the message to a real control. */
  id: string;
  label: string;
};

export type UserMessageInput = {
  category: UserMessageCategory;
  /** Reviewed business wording such as "approve this access request". */
  action: string;
  reason?: BusinessReason;
  fields?: readonly FieldIssue[];
  /** A dependency name only when it is safe and useful to show to the user. */
  dependency?: string;
  /** Actions the current caller can actually perform in this screen and role. */
  availableActions?: readonly AvailableUserAction[];
  /** Exact API-provided request/correlation identifier, when available. */
  requestId?: string;
  /** Stable API code and HTTP status, preserved for programmatic consumers. */
  code?: string;
  status?: number;
  /** Set only when the caller knows retry is safe. Defaults to false. */
  retryable?: boolean;
};

export type UserMessage = {
  category: UserMessageCategory;
  title: string;
  humanMessage: string;
  fieldErrors: Readonly<Record<string, string>>;
  nextActions: readonly AvailableUserAction[];
  requestId?: string;
  retryable: boolean;
  /** Machine-readable API metadata; never substituted for humanMessage. */
  code?: string;
  status?: number;
};

export type MappedUserFailure = {
  category: UserMessageCategory;
  reason?: BusinessReason;
};

const knownCodeMap: Record<string, MappedUserFailure> = {
  VALIDATION_ERROR: { category: "input" },
  INVALID_ARGUMENT: { category: "input" },
  BUSINESS_RULE_VIOLATION: { category: "business" },
  DUPLICATE_REQUEST: { category: "business", reason: "duplicate" },
  RECORD_NOT_FOUND: { category: "business", reason: "not_found" },
  INVALID_STATE_TRANSITION: { category: "business", reason: "invalid_transition" },
  DEPENDENCY_MISSING: { category: "business", reason: "missing_dependency" },
  LIMIT_EXCEEDED: { category: "business", reason: "limit_exceeded" },
  UNSUPPORTED_VALUE: { category: "business", reason: "unsupported_value" },
  ACCESS_DENIED: { category: "auth" },
  "42501": { category: "auth" },
  SESSION_EXPIRED: { category: "session" },
  MFA_REQUIRED: { category: "mfa" },
  MFA_FAILED: { category: "mfa" },
  MFA_UNAVAILABLE: { category: "mfa" },
  NETWORK_ERROR: { category: "network" },
  TIMEOUT: { category: "timeout" },
  ETIMEDOUT: { category: "timeout" },
  EDGE_TIMEOUT: { category: "timeout" },
  DEPENDENCY_UNAVAILABLE: { category: "dependency" },
  PGRST002: { category: "dependency" },
  PGRST003: { category: "dependency" },
  WRITE_OUTCOME_UNKNOWN: { category: "unknown_write_outcome" },
  UNKNOWN_WRITE_OUTCOME: { category: "unknown_write_outcome" },
  INTERNAL_ERROR: { category: "system" },
  INTERNAL_SERVER_ERROR: { category: "system" },
};

const categoryCopy: Record<UserMessageCategory, { title: string; message: string }> = {
  input: {
    title: "Review the request details",
    message:
      "Some information does not meet the requirements for this action. Correct the highlighted fields and try again.",
  },
  business: {
    title: "This action needs attention",
    message:
      "The request does not meet a business rule for this action. Review the details and choose an available next step.",
  },
  auth: {
    title: "You do not have access to this action",
    message:
      "Your current access does not allow this action. Contact your administrator or use an available access request action.",
  },
  session: {
    title: "Sign in to continue",
    message: "Your session is no longer active. Sign in again, then return to this action.",
  },
  mfa: {
    title: "Verify your identity to continue",
    message:
      "This action requires identity verification. Complete the available verification step, then try again.",
  },
  network: {
    title: "Connection interrupted",
    message:
      "We could not reach the service for this action. Check your connection and use an available next step.",
  },
  timeout: {
    title: "The request took longer than expected",
    message:
      "We did not receive a response in time. Check the request status before deciding whether to try again.",
  },
  dependency: {
    title: "A required service is unavailable",
    message:
      "A service needed for this action could not be reached. Try an available next step when the service is available.",
  },
  system: {
    title: "We could not complete this action",
    message:
      "An unexpected issue interrupted this action. Try an available next step or contact support with the request reference.",
  },
  unknown_write_outcome: {
    title: "Check the request before retrying",
    message:
      "We could not confirm whether this action completed. Check the existing request and its status before retrying; do not submit it again until its outcome is clear.",
  },
};

const businessReasonCopy: Record<BusinessReason, string> = {
  duplicate: "A matching request already exists.",
  not_found: "The requested record could not be found or is outside your permitted scope.",
  invalid_transition: "The request is not in a state that allows this action.",
  missing_dependency: "A required item is missing from the request.",
  limit_exceeded: "The request exceeds a limit that applies to this action.",
  unsupported_value: "The selected value is not supported for this action.",
};

/** Map only recognized machine codes/statuses; unknown failures stay unclassified. */
export function mapKnownFailure(code?: string, status?: number): MappedUserFailure {
  const mapped = code ? knownCodeMap[code] : undefined;
  if (mapped) return mapped;
  if (status === 400 || status === 422) return { category: "input" };
  if (status === 401) return { category: "session" };
  if (status === 403) return { category: "auth" };
  if (status === 408) return { category: "timeout" };
  if (status === 502 || status === 503 || status === 504) return { category: "dependency" };
  return { category: "system" };
}

function safeLabel(value: string, fallback: string): string {
  const trimmed = value.trim();
  const diagnosticLike =
    /\b(?:password|secret|api[_ -]?key|provider[_ -]?token|access[_ -]?token|service[_ -]?role)\s*[:=]|\b(?:stack trace|traceback|select\s+.+\s+from|insert\s+into|drop\s+table)\b/i;
  if (
    !trimmed ||
    trimmed.length > 120 ||
    /[\r\n<>]/.test(trimmed) ||
    diagnosticLike.test(trimmed)
  ) {
    return fallback;
  }
  return trimmed;
}

function formatFieldIssue(issue: FieldIssue): string {
  const field = safeLabel(issue.field, "This field");
  switch (issue.issue) {
    case "required":
      return `${field} is required.`;
    case "invalid_format":
      return `Enter a valid ${field.toLocaleLowerCase()}.`;
    case "unsupported_value": {
      const values = issue.allowedValues?.map((value) => safeLabel(value, "")).filter(Boolean);
      return values?.length
        ? `Select a supported ${field.toLocaleLowerCase()}: ${values.join(", ")}.`
        : `Select a supported ${field.toLocaleLowerCase()}.`;
    }
    case "too_long":
      return Number.isSafeInteger(issue.limit) && issue.limit! >= 0
        ? `${field} must be ${issue.limit} characters or fewer.`
        : `Shorten ${field.toLocaleLowerCase()}.`;
    case "too_large":
      return Number.isSafeInteger(issue.limit) && issue.limit! >= 0
        ? `${field} must not exceed the ${issue.limit} limit.`
        : `Reduce ${field.toLocaleLowerCase()}.`;
  }
}

function safeCode(code?: string): string | undefined {
  return code && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(code) ? code : undefined;
}

function safeRequestId(requestId?: string): string | undefined {
  return requestId && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(requestId) ? requestId : undefined;
}

/** Format a reviewed business failure without reading or displaying raw error text. */
export function formatUserMessage(input: UserMessageInput): UserMessage {
  const action = safeLabel(input.action, "this request");
  const base = categoryCopy[input.category];
  const reason =
    input.category === "business" && input.reason ? ` ${businessReasonCopy[input.reason]}` : "";
  const dependency =
    input.category === "dependency" && input.dependency
      ? ` ${safeLabel(input.dependency, "A required service")} is currently unavailable.`
      : "";
  const fields: Record<string, string> = {};
  for (const field of input.fields ?? []) {
    const key = safeLabel(field.field, "");
    if (key) fields[key] = formatFieldIssue(field);
  }
  const nextActions = (input.availableActions ?? [])
    .filter((item) => /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(item.id))
    .map((item) => ({ id: item.id, label: safeLabel(item.label, "View request status") }));

  return {
    category: input.category,
    title: base.title,
    humanMessage: `${base.message.replace("this action", action)}${reason}${dependency}`,
    fieldErrors: fields,
    nextActions,
    requestId: safeRequestId(input.requestId),
    retryable: input.category === "unknown_write_outcome" ? false : input.retryable === true,
    code: safeCode(input.code),
    status:
      Number.isInteger(input.status) && input.status! >= 100 && input.status! <= 599
        ? input.status
        : undefined,
  };
}
