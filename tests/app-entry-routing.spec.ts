import { describe, expect, it } from "vitest";
import { applyDevHostRewrite } from "@/lib/dev-host-rewrite";

describe("public website and app entry routing", () => {
  it("redirects the production app root to sign-in before rendering", () => {
    const response = applyDevHostRewrite(new Request("https://app.reconiq.example/"));
    expect(response?.status).toBe(302);
    expect(response?.headers.get("location")).toBe("/auth");
    expect(response?.headers.get("cache-control")).toBe("no-store");
  });

  it.each(["reconiq.example", "www.reconiq.example"])("keeps marketing on %s", (host) => {
    expect(applyDevHostRewrite(new Request(`https://${host}/`))).toBeNull();
  });

  it.each(["/auth", "/reset-password", "/workspace", "/api/v1/reconciliations"])("preserves app deep links: %s", (path) => {
    expect(applyDevHostRewrite(new Request(`https://app.reconiq.example${path}`))).toBeNull();
  });

  it.each(["dev.app.reconiq.example", "staging.app.reconiq.example"])("preserves existing %s entry routing", (host) => {
    expect(applyDevHostRewrite(new Request(`https://${host}/`))?.headers.get("location")).toBe("/auth");
  });
});
