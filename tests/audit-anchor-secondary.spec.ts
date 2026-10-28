import { describe, it, expect, vi } from "vitest";
import { writeSecondaryAnchor, buildAnchorTweetText } from "@/lib/audit-anchor-secondary.server";

function mkAdmin() {
  const inserts: Array<{ table: string; row: any }> = [];
  const admin = {
    from(table: string) {
      return {
        insert: async (row: unknown) => {
          inserts.push({ table, row });
          return { error: null };
        },
      };
    },
  };
  return { admin: admin as any, inserts };
}

const ANCHOR = {
  id: "anchor-1",
  anchored_at: "2026-06-30T03:30:00.000Z",
  last_audit_id: 12345,
  row_hash_hex: "deadbeefcafebabe",
};

describe("C-2 writeSecondaryAnchor", () => {
  it("happy path: POSTs to Twitter and logs an info security_event", async () => {
    const { admin, inserts } = mkAdmin();
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ data: { id: "1800000000000000000" } }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );
    const env = {
      SECONDARY_ANCHOR_ENABLED: "true",
      TWITTER_API_KEY: "k",
      TWITTER_API_SECRET: "s",
      TWITTER_ACCESS_TOKEN: "at",
      TWITTER_ACCESS_SECRET: "ats",
    };
    const r = await writeSecondaryAnchor(admin, ANCHOR, env, fetchSpy as any);
    expect(r.status).toBe("published");
    expect(r.externalRef).toBe("twitter:1800000000000000000");
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.twitter.com/2/tweets");
    expect((init as any).method).toBe("POST");
    const authHeader = (init as any).headers.Authorization as string;
    expect(authHeader).toMatch(/^OAuth /);
    expect(authHeader).toMatch(/oauth_signature_method="HMAC-SHA1"/);
    expect(authHeader).toMatch(/oauth_consumer_key="k"/);
    expect((init as any).body).toContain(ANCHOR.row_hash_hex);
    const ev = inserts.find((i) => i.table === "security_events");
    expect(ev?.row.event_type).toBe("audit.anchor.secondary.published");
    expect(ev?.row.severity).toBe("info");
    expect(ev?.row.context.external_ref).toBe("twitter:1800000000000000000");
  });

  it("missing env: logs a warning event and returns status=skipped", async () => {
    const { admin, inserts } = mkAdmin();
    const fetchSpy = vi.fn();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await writeSecondaryAnchor(
      admin,
      ANCHOR,
      { SECONDARY_ANCHOR_ENABLED: "true" },
      fetchSpy as unknown as Parameters<typeof writeSecondaryAnchor>[3],
    );
    expect(r.status).toBe("skipped");
    expect(r.reason).toBe("missing_twitter_oauth_env");
    expect(fetchSpy).not.toHaveBeenCalled();
    const ev = inserts.find((i) => i.table === "security_events");
    expect(ev?.row.event_type).toBe("audit.anchor.secondary.skipped");
    expect(ev?.row.severity).toBe("info");
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("non-2xx response: returns failed and logs warning event", async () => {
    const { admin, inserts } = mkAdmin();
    const fetchSpy = vi.fn(async () =>
      new Response("Forbidden", { status: 403 }),
    );
    const env = {
      SECONDARY_ANCHOR_ENABLED: "true",
      TWITTER_API_KEY: "k",
      TWITTER_API_SECRET: "s",
      TWITTER_ACCESS_TOKEN: "at",
      TWITTER_ACCESS_SECRET: "ats",
    };
    const r = await writeSecondaryAnchor(admin, ANCHOR, env, fetchSpy as any);
    expect(r.status).toBe("failed");
    expect(r.reason).toBe("http_403");
    const ev = inserts.find((i) => i.table === "security_events");
    expect(ev?.row.event_type).toBe("audit.anchor.secondary.failed");
    expect(ev?.row.severity).toBe("warning");
  });

  it("buildAnchorTweetText stays under 280 chars and contains the row_hash", () => {
    const t = buildAnchorTweetText(ANCHOR);
    expect(t.length).toBeLessThan(280);
    expect(t).toContain(ANCHOR.row_hash_hex);
    expect(t).toContain(String(ANCHOR.last_audit_id));
  });
});
