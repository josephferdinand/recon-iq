import { env as cloudflareEnv } from "cloudflare:workers";

interface EnvironmentControlPlaneBinding {
  fetch(request: Request): Promise<Response>;
}

type EnvShape = { ENVIRONMENT_CONTROL_PLANE?: EnvironmentControlPlaneBinding } & Record<
  string,
  unknown
>;

function getBinding() {
  const globalEnv = globalThis as unknown as { __env?: EnvShape; env?: EnvShape };
  const runtime = globalEnv.__env ?? globalEnv.env ?? (cloudflareEnv as EnvShape);
  const binding = runtime?.ENVIRONMENT_CONTROL_PLANE;
  return binding && typeof binding.fetch === "function" ? binding : null;
}

export async function checkEnvironmentChangeIntake(): Promise<"open" | "paused" | "unavailable"> {
  const binding = getBinding();
  if (!binding) return "unavailable";
  try {
    const response = await binding.fetch(
      new Request("https://fvi-environment-control-plane.internal/health"),
    );
    if (!response.ok) return "unavailable";
    const health = (await response.json()) as {
      target_configured?: boolean;
      environment_change_imports_paused?: boolean;
    };
    if (health.target_configured !== true) return "unavailable";
    if (health.environment_change_imports_paused === true) return "paused";
    if (health.environment_change_imports_paused === false && health.target_configured === true) {
      return "open";
    }
    return "unavailable";
  } catch {
    return "unavailable";
  }
}

export async function transmitEnvironmentChange(args: {
  sourceRequestId: string;
  sourceEnvironment: "dev" | "uat" | "prod";
  authorization: string;
}) {
  const binding = getBinding();
  if (!binding) throw new Error("Environment control-plane binding is unavailable");
  const response = await binding.fetch(
    new Request("https://fvi-environment-control-plane.internal/v1/environment-changes/receive", {
      method: "POST",
      headers: {
        authorization: args.authorization,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        source_request_id: args.sourceRequestId,
        source_environment: args.sourceEnvironment,
      }),
    }),
  );
  const payload = (await response.json()) as {
    ok?: boolean;
    target_change_request_uid?: string;
    error?: string;
  };
  if (!response.ok || !payload.ok || !payload.target_change_request_uid) {
    throw new Error(payload.error ?? `Environment transport failed with HTTP ${response.status}`);
  }
  return { targetChangeRequestUid: payload.target_change_request_uid };
}
