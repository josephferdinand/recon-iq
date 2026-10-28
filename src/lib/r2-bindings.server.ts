// R2 binding accessor for Cloudflare Workers runtime.
// Server-only — never import from client code.
//
// TanStack Start on Cloudflare exposes bindings in several places depending on
// adapter version. We probe each known location and return the binding when
// found, or null when running outside the Worker (dev / tests / Node host).
import { env as cloudflareEnv } from "cloudflare:workers";

export interface R2PutResult {
  key: string;
  etag?: string;
}

export interface R2ObjectBody {
  customMetadata?: Record<string, string>;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface R2BucketLike {
  put(
    key: string,
    value: string | ArrayBuffer | ReadableStream,
    options?: { customMetadata?: Record<string, string>; httpMetadata?: { contentType?: string } },
  ): Promise<R2PutResult | null>;
  get(key: string): Promise<R2ObjectBody | null>;
}

type EnvShape = {
  AUDIT_ANCHORS?: R2BucketLike;
  BACKUPS?: R2BucketLike;
} & Record<string, unknown>;

export type R2BindingName = "AUDIT_ANCHORS" | "BACKUPS";

function probeEnv(): EnvShape | null {
  // LL-088 (2026-08-23): The previous implementation also probed
  // `@tanstack/react-start/server` via CommonJS `require(...)`. That call throws
  // at module-load time inside the Cloudflare Workers ESM context (CJS interop
  // is unavailable in the SSR worker), surfacing as a Worker-init 500 on any
  // route that imports this module. Keep ONLY the globalThis probes here —
  // the request-context probe is non-essential and can be re-introduced later
  // behind a try/catch+dynamic-import pattern.
  const g = globalThis as unknown as {
    __env?: EnvShape;
    env?: EnvShape;
  };
  if (g.__env && typeof g.__env === "object") return g.__env;
  if (g.env && typeof g.env === "object" && "AUDIT_ANCHORS" in g.env) return g.env;
  if (cloudflareEnv && typeof cloudflareEnv === "object") return cloudflareEnv as EnvShape;

  return null;
}

export function getR2Binding(name: R2BindingName): R2BucketLike | null {
  const env = probeEnv();
  const bucket = env?.[name];
  if (!bucket || typeof (bucket as R2BucketLike).put !== "function") {
    console.error("[r2] binding unavailable", {
      name,
      envPresent: Boolean(env),
      bindingPresent: Boolean(bucket),
      bindingType: typeof bucket,
      hasPut: Boolean(bucket && typeof (bucket as R2BucketLike).put === "function"),
      resourceBindings: Object.keys(env ?? {}).filter((key) =>
        key === "AUDIT_ANCHORS" || key === "BACKUPS"),
    });
    return null;
  }
  return bucket as R2BucketLike;
}
