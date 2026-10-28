/** Human-readable run identifier. The UUID remains the API/database key. */
export function formatReconRunId(runUid: string | null | undefined, id: string): string {
  const uid = runUid?.trim();
  if (uid) return uid.toUpperCase();
  return `R-${id.replaceAll("-", "").toUpperCase()}`;
}
