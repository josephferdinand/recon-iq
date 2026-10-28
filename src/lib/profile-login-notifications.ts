import type { ProfilePasswordAuthClient, ProfilePasswordVerification } from "./profile-password-change";
type Tokens = { access_token: string; refresh_token: string };
type Capture = { mode: "legacy" } | { mode: "captured"; ok: false; error: { message: string; code: string; status: number; requestId?: string } } | { mode: "captured"; ok: true; value: Tokens };
type Client = ProfilePasswordAuthClient & { setSession(tokens: Tokens): ReturnType<ProfilePasswordAuthClient["signInWithPassword"]> };

export function profileLoginVerification(auth: Client, calls: {
  password(input: { data: { attemptId: string; password: string } }): Promise<Capture>;
  mfa(input: { data: { attemptId: string; factorId: string; code: string } }): Promise<Capture>;
}): ProfilePasswordVerification {
  return {
    reauthenticate: async credentials => {
      const captured = await calls.password({ data: { attemptId: crypto.randomUUID(), password: credentials.password } });
      if (captured.mode === "legacy") return auth.signInWithPassword(credentials);
      if (!captured.ok) return { data: { user: null, session: null }, error: captured.error };
      return auth.setSession(captured.value);
    },
    verifyMfa: async challenge => {
      const captured = await calls.mfa({ data: { attemptId: crypto.randomUUID(), ...challenge } });
      if (captured.mode === "legacy") return auth.mfa.challengeAndVerify(challenge);
      if (!captured.ok) return { data: null, error: captured.error };
      return auth.setSession(captured.value);
    },
  };
}
