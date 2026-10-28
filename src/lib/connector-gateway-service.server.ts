import { env as cloudflareEnv } from "cloudflare:workers";
import type { SupabaseClient } from "@supabase/supabase-js";

interface ConnectorGatewayBinding {
  fetch(request: Request): Promise<Response>;
}

type EnvShape = { CONNECTOR_GATEWAY?: ConnectorGatewayBinding } & Record<string, unknown>;

function getConnectorGateway(): ConnectorGatewayBinding | null {
  const globalEnv = globalThis as unknown as { __env?: EnvShape; env?: EnvShape };
  const runtime = globalEnv.__env ?? globalEnv.env ?? (cloudflareEnv as EnvShape);
  const binding = runtime?.CONNECTOR_GATEWAY;
  return binding && typeof binding.fetch === "function" ? binding : null;
}

export async function pullWithConnectorGateway(args: {
  admin: SupabaseClient;
  tenantId: string;
  connectorType: string;
  config: Record<string, unknown>;
  binding?: ConnectorGatewayBinding | null;
}) {
  const binding = args.binding ?? getConnectorGateway();
  if (!binding) throw new Error("Connector gateway binding unavailable");
  const secretName =
    typeof args.config.credential_secret_name === "string"
      ? args.config.credential_secret_name
      : null;
  if (secretName && !/^FVI_CONNECTOR_[A-Z0-9_]{1,100}$/u.test(secretName)) {
    throw new Error("Connector credential reference is invalid");
  }
  const resolved = secretName
    ? await import("@/lib/vault-resolver.server").then(({ resolveVaultSecret }) =>
        resolveVaultSecret(args.admin, {
          scope: "tenant",
          tenant_id: args.tenantId,
          secret_class: "integration_token",
          name: secretName,
        }),
      )
    : null;
  if (secretName && !resolved) throw new Error("Connector credential is unavailable");
  const config = { ...args.config };
  delete config.credential_secret_name;
  const response = await binding.fetch(
    new Request("https://fvi-connector-gateway.internal/v1/pull", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        connector_type: args.connectorType,
        config,
        credential: resolved?.plaintext ?? null,
      }),
    }),
  );
  const payload = (await response.json()) as { rows?: unknown; columns?: unknown; error?: unknown };
  if (!response.ok)
    throw new Error(
      typeof payload.error === "string"
        ? payload.error
        : `Connector gateway failed with HTTP ${response.status}`,
    );
  if (
    !Array.isArray(payload.rows) ||
    payload.rows.length > 50_000 ||
    !Array.isArray(payload.columns)
  ) {
    throw new Error("Connector gateway returned an invalid response");
  }
  return { rows: payload.rows as Record<string, unknown>[], columns: payload.columns.map(String) };
}
