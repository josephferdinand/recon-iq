import { describe, expect, it } from "vitest";
import { isTenantWritableWorkspaceFeature } from "../src/lib/session-feature-policy";

describe("tenant workspace session feature boundary", () => {
  it("keeps the project-wide single-session control out of tenant writes", () => {
    expect(isTenantWritableWorkspaceFeature("single_session_enforcement")).toBe(false);
    expect(isTenantWritableWorkspaceFeature("logout_all_devices")).toBe(true);
  });
});
