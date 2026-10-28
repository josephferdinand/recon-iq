/** Supabase Auth enforces single-session project-wide; tenant toggles cannot change it. */
export function isTenantWritableWorkspaceFeature(key: string): boolean {
  return key !== "single_session_enforcement";
}
