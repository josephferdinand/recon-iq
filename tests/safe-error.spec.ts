import { describe, it, expect, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: () => ({ insert: async () => ({ error: null }) }) },
}));

import { safeSupabaseError } from "@/lib/safe-error.server";

describe("S-1 safeSupabaseError", () => {
  it("maps 42501 -> 403 rls_denied and hides raw message", () => {
    const r = safeSupabaseError(
      { message: "row-level security policy violated for table secrets", code: "42501" },
      { path: "/api/public/x" },
    );
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ error: "rls_denied", code: "42501" });
    expect(JSON.stringify(r.body)).not.toContain("row-level");
  });

  it("maps 23505 -> 409 conflict", () => {
    const r = safeSupabaseError({ message: "dup key", code: "23505" }, { path: "/x" });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("conflict");
  });

  it("maps 23503 -> 400 fk_violation", () => {
    const r = safeSupabaseError({ message: "fk fail", code: "23503" }, { path: "/x" });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("fk_violation");
  });

  it("maps P0001 -> 400 app_error", () => {
    const r = safeSupabaseError({ message: "raised by app", code: "P0001" }, { path: "/x" });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("app_error");
  });

  it("defaults to 500 internal_error and never returns raw .message", () => {
    const r = safeSupabaseError({ message: "deep details PII=abc", code: "XX999" }, { path: "/x" });
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ error: "internal_error" });
    expect(JSON.stringify(r.body)).not.toContain("PII");
  });
});
