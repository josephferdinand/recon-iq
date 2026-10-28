/**
 * Friendly evidence summary for a recorded break payload.
 *
 * Renders only scalar, non-identifier fields as labelled rows. Raw JSON is
 * never shown to end users (see the error-handling standard): nested values,
 * internal ids and credential-shaped keys are omitted, and when nothing
 * displayable was recorded the standard empty copy explains the next step.
 */
export function PayloadEvidenceSummary({ payload }: { payload: unknown }) {
  const record = payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : null;
  const entries = record
    ? Object.entries(record).filter(([key, value]) =>
        !/(_id|uuid|token|secret|password|api_?key)/i.test(key) &&
        (typeof value === "string" || typeof value === "number" || typeof value === "boolean") &&
        !(typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)))
    : [];
  if (entries.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
        No comparable source records were recorded for this case. The recorded values are
        summarised in the case reason above; ask an administrator if you need the underlying
        source extracts.
      </div>
    );
  }
  return (
    <dl className="grid gap-2 rounded-md border bg-muted/20 p-3 text-sm sm:grid-cols-2">
      {entries.map(([key, value]) => (
        <div key={key}>
          <dt className="text-xs text-muted-foreground">{key.replaceAll("_", " ")}</dt>
          <dd className="mt-0.5 break-words">{String(value)}</dd>
        </div>
      ))}
    </dl>
  );
}
