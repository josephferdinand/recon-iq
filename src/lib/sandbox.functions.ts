// Server functions backing the developer portal API sandbox.
// - listSandboxClients / createSandboxClient / revokeSandboxClient — CRUD.
// - runSandboxRequest — proxies a request from the browser to the API, so the
//   sandbox can call any ReconIQ endpoint without CORS gymnastics AND so we can
//   enforce an allow-list, size caps, and auth-mode rules server-side.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { verifySandboxJwt } from "@/lib/sandbox-jwt.server";

const ALLOWED_HOSTS = new Set([
  "app-fvi.reconiq.example",
  "fvi.meta.app",
  "reconintelligence.app",
]);
const MAX_BODY_BYTES = 64 * 1024; // 64 KiB request cap
const MAX_RESPONSE_BYTES = 512 * 1024; // 512 KiB truncation cap
const MAX_TIMEOUT_MS = 15_000;

function randomClientId(): string {
  return "fvi_" + crypto.randomUUID().replace(/-/g, "");
}
function randomClientSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return "sk_" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const listSandboxClients = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("sandbox_oauth_clients")
      .select("id, client_id, name, description, allowed_scopes, active, revoked_at, last_used_at, created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { clients: data ?? [] };
  });

const createInput = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  scopes: z.array(z.enum(["read", "write"])).min(1).max(2).default(["read"]),
});
export const createSandboxClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((v) => createInput.parse(v))
  .handler(async ({ data, context }) => {
    const clientId = randomClientId();
    const clientSecret = randomClientSecret();
    const { data: hashRow, error: hashErr } = await context.supabase.rpc("hash_sandbox_client_secret", { _plain_secret: clientSecret });
    if (hashErr || !hashRow) throw new Error(hashErr?.message ?? "Failed to hash secret");
    const hash = String(hashRow);
    const { data: inserted, error } = await context.supabase
      .from("sandbox_oauth_clients")
      .insert({
        client_id: clientId,
        client_secret_hash: hash,
        name: data.name,
        description: data.description ?? null,
        allowed_scopes: data.scopes,
        created_by: context.userId,
      })
      .select("id, client_id, name, allowed_scopes, created_at")
      .single();
    if (error || !inserted) throw new Error(error?.message ?? "Failed to create client");
    // Secret is returned exactly once.
    return { client: inserted, client_secret: clientSecret };
  });

export const revokeSandboxClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((v) => z.object({ id: z.string().uuid() }).parse(v))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("sandbox_oauth_clients")
      .update({ active: false, revoked_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const proxyInput = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  path: z.string().startsWith("/").max(1024),
  baseUrl: z.string().url().default("https://app-fvi.reconiq.example"),
  headers: z.record(z.string(), z.string()).default({}),
  body: z.string().max(MAX_BODY_BYTES).optional(),
  authMode: z.enum(["session", "client_credentials"]),
  bearer: z.string().min(10).max(4096),
});

export const runSandboxRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((v) => proxyInput.parse(v))
  .handler(async ({ data, context }) => {
    const url = new URL(data.path, data.baseUrl);
    if (!ALLOWED_HOSTS.has(url.host)) {
      throw new Error(`Host not allowed in sandbox: ${url.host}`);
    }
    if (url.pathname.startsWith("/api/admin/") && data.authMode === "client_credentials") {
      throw new Error("Admin endpoints require an authenticated user session, not a client-credentials token.");
    }

    // Validate the bearer up-front so we surface a clear error instead of 401.
    if (data.authMode === "client_credentials") {
      // Vault declares SANDBOX_JWT_SIGNING_SECRET; SANDBOX_JWT_SECRET retained as
      // a one-release alias so a half-rotated deploy still verifies sandbox JWTs.
      const secret = process.env.SANDBOX_JWT_SIGNING_SECRET ?? process.env.SANDBOX_JWT_SECRET;
      if (!secret) throw new Error("Sandbox JWT signing secret is not configured");
      const claims = verifySandboxJwt(data.bearer, secret);
      if (!claims) throw new Error("Invalid or expired client-credentials access token. Request a new one.");
      if (data.method !== "GET" && !String(claims.scope ?? "").split(/\s+/).includes("write")) {
        throw new Error("This token was issued with scope=read; POST/PUT/PATCH/DELETE requires scope=write.");
      }
    }

    const headers: Record<string, string> = {
      accept: "application/json",
      "x-fvi-sandbox": "1",
      "x-fvi-sandbox-user": context.userId,
      authorization: `Bearer ${data.bearer}`,
      ...Object.fromEntries(Object.entries(data.headers).filter(([k]) =>
        !["host", "authorization", "content-length", "connection"].includes(k.toLowerCase()),
      )),
    };
    if (data.body && !headers["content-type"]) headers["content-type"] = "application/json";

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), MAX_TIMEOUT_MS);
    const startedAt = Date.now();
    try {
      const res = await fetch(url.toString(), {
        method: data.method,
        headers,
        body: data.method === "GET" || data.method === "DELETE" ? undefined : data.body,
        signal: ctrl.signal,
        redirect: "manual",
      });
      const buf = await res.arrayBuffer();
      const truncated = buf.byteLength > MAX_RESPONSE_BYTES;
      const bytes = truncated ? buf.slice(0, MAX_RESPONSE_BYTES) : buf;
      const text = new TextDecoder().decode(bytes);
      const resHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => { resHeaders[k] = v; });
      return {
        status: res.status,
        statusText: res.statusText,
        headers: resHeaders,
        body: text,
        bodyBytes: buf.byteLength,
        truncated,
        durationMs: Date.now() - startedAt,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const aborted = ctrl.signal.aborted;
      return {
        status: 0,
        statusText: aborted ? "Aborted (timeout)" : "Network error",
        headers: {},
        body: msg,
        bodyBytes: 0,
        truncated: false,
        durationMs: Date.now() - startedAt,
        error: true as const,
      };
    } finally {
      clearTimeout(timer);
    }
  });
