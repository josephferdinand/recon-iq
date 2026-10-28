// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUser, getAuthenticatorAssuranceLevel } = vi.hoisted(() => ({
  getUser: vi.fn(),
  getAuthenticatorAssuranceLevel: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getUser, mfa: { getAuthenticatorAssuranceLevel } } },
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  redirect: (destination: unknown) => destination,
  Outlet: () => null,
}));

import { Route } from "@/routes/_authenticated/route";

const beforeLoad = (Route as any).options.beforeLoad as (args: { location: { pathname: string; searchStr: string } }) => Promise<unknown>;
const enter = () => beforeLoad({ location: { pathname: "/home", searchStr: "" } });

beforeEach(() => {
  getUser.mockReset().mockResolvedValue({ data: { user: { id: "owner" } }, error: null });
  getAuthenticatorAssuranceLevel.mockReset();
});

describe("authenticated route MFA assurance", () => {
  it("does not admit an authenticated user when the assurance service errors", async () => {
    getAuthenticatorAssuranceLevel.mockResolvedValue({ data: null, error: { message: "network" } });
    await expect(enter()).rejects.toThrow("Security check temporarily unavailable");
  });

  it("does not interpret a missing assurance response as no MFA enrollment", async () => {
    getAuthenticatorAssuranceLevel.mockResolvedValue({ data: null, error: null });
    await expect(enter()).rejects.toThrow("Security check temporarily unavailable");
  });

  it("challenges an enrolled user at aal1", async () => {
    getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: "aal1", nextLevel: "aal2" }, error: null });
    await expect(enter()).rejects.toMatchObject({ to: "/mfa-challenge" });
  });

  it.each(["aal1", "aal2"])("admits a valid %s assurance when no step-up remains", async (level) => {
    getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: level, nextLevel: level }, error: null });
    await expect(enter()).resolves.toMatchObject({ user: { id: "owner" } });
  });
});
