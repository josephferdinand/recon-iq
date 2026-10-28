// C-2 — Secondary anchor publisher.
// Final-review spec: missing env → skip + warn (no throw); env set → POST to
// api.twitter.com with valid auth + body containing row_hash_hex; failed POST
// returns gracefully and writes a security_events warning.
import { describe, it, expect, vi } from "vitest";
import { writeSecondaryAnchor } from "@/lib/audit-anchor-secondary.server";

function mkAdmin() {
  const inserts: Array<{ table: string; row: any }> = [];
  return {
    inserts,
    admin: {
      from(table: string) {
        return {
          insert: async (row: unknown) => {
            inserts.push({ table, row });
            return { error: null };
          },
        };
      },
    } as any,
  };
}

const ANCHOR = {
  id: "anchor-9",
  anchored_at: "2026-06-30T03:30:00.000Z",
  last_audit_id: 99999,
  row_hash_hex: "f00dbabe1337c0de",
};

// Real OAuth 1.0a 4-tuple plus explicit owner-controlled enablement.
const FULL_ENV = {
  SECONDARY_ANCHOR_ENABLED: "true",
  TWITTER_BEARER_TOKEN: "real-token",
  TWITTER_API_KEY: "k",
  TWITTER_API_SECRET: "s",
  TWITTER_ACCESS_TOKEN: "at",
  TWITTER_ACCESS_SECRET: "ats",
};

describe("C-2 writeSecondaryAnchor (secondary-anchor.spec)", () => {
  it("missing env: returns without throwing and writes a warning log", async () => {
    const { admin, inserts } = mkAdmin();
    const fetchSpy = vi.fn();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const r = await writeSecondaryAnchor(
      admin,
      ANCHOR,
      { SECONDARY_ANCHOR_ENABLED: "true", TWITTER_BEARER_TOKEN: undefined },
      fetchSpy as any,
    );

    expect(r.status).toBe("skipped");
    expect(r.reason).toBe("missing_twitter_oauth_env");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    const ev = inserts.find((i) => i.table === "security_events");
    expect(ev?.row.event_type).toBe("audit.anchor.secondary.skipped");
    warnSpy.mockRestore();
  });

  it("env set: POSTs to api.twitter.com with correct auth and body contains row_hash_hex", async () => {
    const { admin, inserts } = mkAdmin();
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ data: { id: "1900000000000000000" } }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );

    const r = await writeSecondaryAnchor(admin, ANCHOR, FULL_ENV, fetchSpy as any);

    expect(r.status).toBe("published");
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toMatch(/^https:\/\/api\.twitter\.com\//);
    expect((init as any).method).toBe("POST");
    const auth = (init as any).headers.Authorization as string;
    expect(auth).toMatch(/^OAuth /);
    expect(auth).toMatch(/oauth_signature_method="HMAC-SHA1"/);
    expect(auth).toMatch(/oauth_consumer_key="k"/);
    expect(auth).toMatch(/oauth_signature="/);
    expect((init as any).body).toContain(ANCHOR.row_hash_hex);

    const ev = inserts.find((i) => i.table === "security_events");
    expect(ev?.row.event_type).toBe("audit.anchor.secondary.published");
    expect(ev?.row.severity).toBe("info");
    expect(ev?.row.context.row_hash_hex).toBe(ANCHOR.row_hash_hex);
  });

  it("failed POST: does not throw — logs a security_events warning and returns gracefully", async () => {
    const { admin, inserts } = mkAdmin();
    const fetchSpy = vi.fn(async () => new Response("Unauthorized", { status: 401 }));

    let threw = false;
    let result: any;
    try {
      result = await writeSecondaryAnchor(admin, ANCHOR, FULL_ENV, fetchSpy as any);
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.reason).toBe("http_401");
    const ev = inserts.find((i) => i.table === "security_events");
    expect(ev?.row.event_type).toBe("audit.anchor.secondary.failed");
    expect(ev?.row.severity).toBe("warning");
  });

  it("network exception: does not throw — logs failed and returns", async () => {
    const { admin, inserts } = mkAdmin();
    const fetchSpy = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });

    const r = await writeSecondaryAnchor(admin, ANCHOR, FULL_ENV, fetchSpy as any);
    expect(r.status).toBe("failed");
    expect(r.reason).toContain("ECONNRESET");
    const ev = inserts.find((i) => i.table === "security_events");
    expect(ev?.row.event_type).toBe("audit.anchor.secondary.failed");
  });
});
