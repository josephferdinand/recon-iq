/** Revoke other Supabase Auth refresh sessions; keep the caller's current session. */
export async function revokeOtherAuthSessions(
  admin: { signOut: (accessToken: string, scope: "others") => Promise<{ error: Error | null }> },
  accessToken: string,
): Promise<void> {
  const { error } = await admin.signOut(accessToken, "others");
  if (error) throw new Error("Could not sign out other devices.");
}
