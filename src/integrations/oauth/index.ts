/**
 * Direct Supabase auth shim. Preserves the existing
 * `signInWithOAuth(provider, opts)` surface so call sites don't change.
 */
import { supabase } from "../supabase/client";

export type OAuthProvider = "google" | "apple" | "microsoft";

type SignInOptions = {
  redirect_uri?: string;
  extraParams?: Record<string, string>;
};

type SignInResult = {
  redirected?: boolean;
  error?: Error;
  tokens?: { access_token: string; refresh_token: string };
};

// Map our public provider names to Supabase OAuth provider IDs.
const PROVIDER_MAP: Record<OAuthProvider, "google" | "apple" | "azure"> = {
  google: "google",
  apple: "apple",
  microsoft: "azure", // Supabase exposes Microsoft via the Azure provider
};

export const oauth = {
  auth: {
    signInWithOAuth: async (
      provider: OAuthProvider,
      opts?: SignInOptions,
    ): Promise<SignInResult> => {
      const supabaseProvider = PROVIDER_MAP[provider];
      if (!supabaseProvider) {
        return { error: new Error(`Unsupported OAuth provider: ${provider}`) };
      }

      const redirectTo =
        opts?.redirect_uri ??
        (typeof window !== "undefined"
          ? `${window.location.origin}/auth/callback`
          : undefined);

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: supabaseProvider,
        options: {
          redirectTo,
          queryParams: opts?.extraParams,
        },
      });

      if (error) {
        return { error: error instanceof Error ? error : new Error(String(error)) };
      }

      if (data?.url) {
        return { redirected: true };
      }

      return {};
    },
  },
};
