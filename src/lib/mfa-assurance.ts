export type AuthenticatorAssurance = {
  currentLevel: string | null;
  nextLevel: string | null;
};

export function requiresMfaChallenge(assurance: AuthenticatorAssurance | null | undefined) {
  return assurance?.nextLevel === "aal2" && assurance.currentLevel !== "aal2";
}

export function safePostMfaRedirect(value: unknown) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/home";
  return value;
}
