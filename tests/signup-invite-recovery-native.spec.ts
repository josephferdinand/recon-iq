import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createSignupAttempt,
  recoverableSignupInterest,
  signupInterestSchema,
  signupDigest,
  type SignupAttempt,
} from "@/lib/signup-registration";

// Explicit local PG17 suite. No ports, external network or provider sends.
// Only its own new fixture container is stopped; the fixture is retained.
const container = `fvi-faraday-invite-recovery-${Date.now()}`;
let created = false;
const sql = (query: string) =>
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-U",
      "postgres",
      "-X",
      "-q",
      "-A",
      "-t",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { input: query, encoding: "utf8", timeout: 10000 },
  ).trim();
const quoted = (v: unknown) =>
  v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`;
function rpcQuery(action: string, v: Record<string, unknown>) {
  return `SELECT public.signup_invite_recovery(${[action, v._attempt_id, v._email_hash, v._payload_hash, v._recovery_hash, v._lease_id, v._outcome, v._code, v._status].map(quoted).join(",")});`;
}
async function values(a: SignupAttempt) {
  return {
    _attempt_id: a.attemptId,
    _email_hash: await signupDigest(a.email),
    _payload_hash: await signupDigest(JSON.stringify([a.email, a.full_name])),
    _recovery_hash: await signupDigest(a.recoveryToken),
  };
}
function dependencies() {
  return {
    record: vi.fn(async (action: string, v: Record<string, unknown>) =>
      JSON.parse(sql(`SET ROLE service_role; ${rpcQuery(action, v)}`)),
    ),
    preflight: vi.fn(async (_hash: string) => ({ proceed: true })),
    invite: vi.fn(async () => ({
      data: { user: { id: "40000000-0000-4000-8000-000000000001" } },
      error: null as unknown,
    })),
  };
}
const input = (a: SignupAttempt, mode: "submit" | "check" = "submit") =>
  signupInterestSchema.parse({ ...a, mode });
const attempt = (tag: string) => createSignupAttempt(`${tag}@fixture.invalid`, `Fixture ${tag}`);

beforeAll(async () => {
  execFileSync("docker", ["image", "inspect", "postgres:17.6-alpine"], { stdio: "ignore" });
  execFileSync(
    "docker",
    [
      "run",
      "-d",
      "--name",
      container,
      "--network",
      "none",
      "--label",
      "fvi.scope=faraday-registration-recovery",
      "-e",
      "POSTGRES_HOST_AUTH_METHOD=trust",
      "postgres:17.6-alpine",
    ],
    { stdio: "ignore" },
  );
  created = true;
  for (let i = 0; i < 60; i++) {
    try {
      sql("SELECT 1");
      break;
    } catch {
      if (i === 59) throw new Error("Local PG17 setup unavailable; no fixture success claimed");
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  sql(
    "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE TABLE public.existing_history(id integer PRIMARY KEY,value text); INSERT INTO public.existing_history VALUES(1,'keep unchanged');",
  );
  expect(Number(sql("SHOW server_version_num"))).toBeGreaterThanOrEqual(170000);
  expect(Number(sql("SHOW server_version_num"))).toBeLessThan(180000);
  sql(
    readFileSync(
      "docs/handover/returns/2026-10-03-faraday-registration-recovery-packet/signup-invitation-recovery.sql",
      "utf8",
    ),
  );
  console.info(`[FARADAY_LOCAL_PG17] ${container}`);
}, 30000);
afterAll(() => {
  if (created) execFileSync("docker", ["stop", container], { stdio: "ignore", timeout: 15000 });
});

describe("actual local PG17 durable invitation fencing", () => {
  it("success and reload replay retain correlation and issue Auth once", async () => {
    const a = attempt("accepted"),
      deps = dependencies();
    const first = await recoverableSignupInterest(input(a), deps);
    expect(first).toMatchObject({
      outcome: "accepted",
      retryable: false,
      code: "SIGNUP_INVITE_ACCEPTED",
      status: 200,
    });
    expect(first.requestId).toMatch(/^FVI-[A-F0-9]{12}$/);
    expect(await recoverableSignupInterest(input(a, "check"), deps)).toEqual(first);
    expect(await recoverableSignupInterest(input(a), deps)).toEqual(first);
    expect(deps.invite).toHaveBeenCalledTimes(1);
    expect(deps.preflight).toHaveBeenCalledTimes(1);
  });
  it("unknown result is durable and a new identity for the same email cannot resend", async () => {
    const a = attempt("unknown"),
      deps = dependencies();
    deps.invite.mockResolvedValue({
      data: { user: { id: "" } },
      error: { code: "unexpected_failure", status: 503, message: "SQL PASSWORD NEVER_REAL" },
    });
    const first = await recoverableSignupInterest(input(a), deps);
    expect(first).toMatchObject({
      outcome: "unknown",
      retryable: false,
      code: "WRITE_OUTCOME_UNKNOWN",
      status: 503,
    });
    expect(JSON.stringify(first)).not.toContain("PASSWORD");
    expect(await recoverableSignupInterest(input(a, "check"), deps)).toEqual(first);
    expect(await recoverableSignupInterest(input(a), deps)).toEqual(first);
    expect(
      (await recoverableSignupInterest(input(createSignupAttempt(a.email, a.full_name)), deps))
        .retryable,
    ).toBe(false);
    expect(deps.invite).toHaveBeenCalledTimes(1);
  });
  it.each(["email_exists", "user_already_exists"])(
    "typed duplicate %s is terminal and replay-safe",
    async (code) => {
      const a = attempt(code),
        deps = dependencies();
      deps.invite.mockResolvedValue({ data: { user: { id: "" } }, error: { code, status: 422 } });
      expect((await recoverableSignupInterest(input(a), deps)).outcome).toBe("existing");
      expect((await recoverableSignupInterest(input(a), deps)).outcome).toBe("existing");
      expect(deps.invite).toHaveBeenCalledTimes(1);
    },
  );
  it("lost settlement leaves sending fenced and never claims safe retry", async () => {
    const a = attempt("lost-receipt"),
      deps = dependencies(),
      original = deps.record;
    const record = async (action: string, v: Record<string, unknown>) => {
      if (action === "settle") throw new Error("fixture lost write response");
      return original(action, v);
    };
    const first = await recoverableSignupInterest(input(a), { ...deps, record });
    expect(first).toMatchObject({ outcome: "unknown", retryable: false });
    expect(await recoverableSignupInterest(input(a), deps)).toMatchObject({
      outcome: "unknown",
      retryable: false,
      requestId: first.requestId,
    });
    expect(deps.invite).toHaveBeenCalledTimes(1);
  });
  it("pre-invite rate denial safely continues the same original request", async () => {
    const a = attempt("limited"),
      deps = dependencies();
    expect(
      await recoverableSignupInterest(input(a), {
        ...deps,
        preflight: async () => ({ proceed: false, code: "SIGNUP_RATE_LIMITED", status: 429 }),
      }),
    ).toMatchObject({ outcome: "not_sent", retryable: true, status: 429 });
    expect(deps.invite).not.toHaveBeenCalled();
    expect((await recoverableSignupInterest(input(a), deps)).outcome).toBe("accepted");
    expect(deps.invite).toHaveBeenCalledTimes(1);
  });
  it("forged proof or changed fields do not invoke Auth or expose another reference", async () => {
    const a = attempt("proof"),
      deps = dependencies();
    await recoverableSignupInterest(input(a), deps);
    for (const changed of [
      { ...a, recoveryToken: "f".repeat(64) },
      { ...a, full_name: "Changed" },
      { ...a, email: "other@fixture.invalid" },
    ]) {
      const result = await recoverableSignupInterest(input(changed), deps);
      expect(result).toMatchObject({ outcome: "unknown", retryable: false });
      expect(result.requestId).toBeUndefined();
      const checked = await recoverableSignupInterest(input(changed, "check"), deps);
      expect(checked).toMatchObject({ outcome: "unknown", retryable: false });
      expect(checked.requestId).toBeUndefined();
    }
    expect(deps.invite).toHaveBeenCalledTimes(1);
  });
  it.each(["anon", "authenticated"])("%s has no registry read or RPC privilege", (role) => {
    expect(() =>
      sql(`SET ROLE ${role}; SELECT * FROM public.signup_invitation_attempts;`),
    ).toThrow();
    expect(() =>
      sql(
        `SET ROLE ${role}; SELECT public.signup_invite_recovery('check',gen_random_uuid(),'${"a".repeat(64)}','${"b".repeat(64)}','${"c".repeat(64)}');`,
      ),
    ).toThrow();
  });
  it("service role cannot bypass the RPC by direct registry reads", () =>
    expect(() =>
      sql("SET ROLE service_role; SELECT * FROM public.signup_invitation_attempts;"),
    ).toThrow());
  it("two real database sessions racing to claim receive exactly one lease", async () => {
    const a = attempt("race"),
      v = await values(a),
      deps = dependencies();
    await deps.record("reserve", v);
    const claim = () =>
      new Promise<string>((resolve, reject) => {
        const child = spawn("docker", [
          "exec",
          "-i",
          container,
          "psql",
          "-U",
          "postgres",
          "-X",
          "-q",
          "-A",
          "-t",
          "-v",
          "ON_ERROR_STOP=1",
        ]);
        let output = "",
          error = "";
        child.stdout.on("data", (c) => (output += c));
        child.stderr.on("data", (c) => (error += c));
        child.on("error", reject);
        child.on("close", (code) => (code === 0 ? resolve(output) : reject(new Error(error))));
        child.stdin.end(
          `BEGIN; SET LOCAL ROLE service_role; ${rpcQuery("claim", v)} SELECT pg_sleep(0.2); COMMIT;`,
        );
      });
    const rows = (await Promise.all([claim(), claim()])).map((o) =>
      JSON.parse(o.split("\n").find((l) => l.startsWith("{"))!),
    );
    expect(rows.filter((r) => r.claimed)).toHaveLength(1);
    expect(rows.filter((r) => r.lease_id)).toHaveLength(1);
  });
  it("additive SQL preserves existing history and stores no raw identity or credential fields", () => {
    expect(sql("SELECT value FROM public.existing_history WHERE id=1")).toBe("keep unchanged");
    const columns = sql(
      "SELECT string_agg(column_name,',') FROM information_schema.columns WHERE table_schema='public' AND table_name='signup_invitation_attempts'",
    );
    expect(columns).not.toMatch(/(^|,)(email|full_name|password|recovery_token|access_token)(,|$)/);
  });
  it("two browser identities for one email share the durable provider fence", async () => {
    const a = attempt("two-tabs"),
      b = createSignupAttempt(a.email, a.full_name),
      deps = dependencies();
    const results = await Promise.all([
      recoverableSignupInterest(input(a), deps),
      recoverableSignupInterest(input(b), deps),
    ]);
    expect(results.filter((r) => r.outcome === "accepted")).toHaveLength(1);
    expect(deps.invite).toHaveBeenCalledTimes(1);
  });
  it("unavailable registry cannot fall back to an untracked Auth invitation", async () => {
    const a = attempt("registry-down"),
      deps = dependencies();
    const result = await recoverableSignupInterest(input(a), {
      ...deps,
      record: async () => {
        throw new Error("PRIVATE SQL fixture");
      },
    });
    expect(result).toMatchObject({ outcome: "unknown", retryable: false });
    expect(result.requestId).toBeUndefined();
    expect(deps.invite).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
  });
  it("strict input rejects forged outcomes and unsupported attempt identities before any handler", () => {
    const a = attempt("invalid-input");
    expect(() =>
      signupInterestSchema.parse({
        ...a,
        outcome: "accepted",
        recipient: "forged@fixture.invalid",
      }),
    ).toThrow();
    expect(() => signupInterestSchema.parse({ ...a, attemptId: "unsafe" })).toThrow();
    expect(() => signupInterestSchema.parse({ ...a, recoveryToken: "short" })).toThrow();
  });
  it("a fresh identity can proceed after an earlier pre-invite failure but Auth still runs once", async () => {
    const a = attempt("fresh-preflight"),
      deps = dependencies();
    await recoverableSignupInterest(input(a), {
      ...deps,
      preflight: async () => ({ proceed: false, code: "SIGNUP_NOT_STARTED", status: 503 }),
    });
    expect(
      (await recoverableSignupInterest(input(createSignupAttempt(a.email, a.full_name)), deps))
        .outcome,
    ).toBe("accepted");
    expect((await recoverableSignupInterest(input(a), deps)).retryable).toBe(false);
    expect(deps.invite).toHaveBeenCalledTimes(1);
  });
  it("reload before the original handler arrived creates only a pre-invite record", async () => {
    const a = attempt("check-first"),
      deps = dependencies();
    expect(await recoverableSignupInterest(input(a, "check"), deps)).toMatchObject({
      outcome: "not_sent",
      retryable: true,
    });
    expect(deps.invite).not.toHaveBeenCalled();
    expect(deps.preflight).not.toHaveBeenCalled();
    expect((await recoverableSignupInterest(input(a), deps)).outcome).toBe("accepted");
    expect(deps.invite).toHaveBeenCalledTimes(1);
  });
  it("parent preapply guard refuses an existing/partial prior packet without changing data", () => {
    expect(() =>
      sql(
        readFileSync(
          "docs/handover/returns/2026-10-03-faraday-registration-recovery-packet/parent-preapply-guard.sql",
          "utf8",
        ),
      ),
    ).toThrow();
    expect(sql("SELECT value FROM public.existing_history WHERE id=1")).toBe("keep unchanged");
  });
});
