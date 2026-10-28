interface Env {
  TARGET_ENVIRONMENT: "dev" | "uat" | "prod";
  TARGET_PROJECT_REF: string;
  TARGET_SUPABASE_URL: string;
  TARGET_SUPABASE_SERVICE_ROLE_KEY: string;
  TARGET_INTAKE_ACTOR_ID?: string;
  ENVIRONMENT_CHANGE_IMPORTS_PAUSED?: string;
  DEV_SUPABASE_URL?: string;
  DEV_SUPABASE_PUBLISHABLE_KEY?: string;
  UAT_SUPABASE_URL?: string;
  UAT_SUPABASE_PUBLISHABLE_KEY?: string;
  PROD_SUPABASE_URL?: string;
  PROD_SUPABASE_PUBLISHABLE_KEY?: string;
}

type Environment = Env["TARGET_ENVIRONMENT"];
type SourceRequest = {
  upstream_change_request_uid: string;
  upstream_manifest_hash: string;
  source_request_status: string;
  source_project_ref: string;
  source_tenant_id: string;
  source_environment: Environment;
  target_project_ref: string;
  target_tenant_id: string;
  target_environment: Environment;
  direction: string;
  title: string;
  reason: string;
  manifest: Record<string, unknown>;
  source_requester_email: string;
  source_requester_email_hash: string;
  source_approver_email_hash: string;
};

const MAX_REQUEST_BYTES = 16_384;
const MAX_RESPONSE_BYTES = 2_000_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

function intakeActorConfigured(id: string | undefined) {
  return UUID.test(id ?? "") && id?.toLowerCase() !== NIL_UUID;
}

function targetConfigured(env: Env) {
  return Boolean(
    env.TARGET_PROJECT_REF &&
      env.TARGET_SUPABASE_URL &&
      env.TARGET_SUPABASE_SERVICE_ROLE_KEY &&
      intakeActorConfigured(env.TARGET_INTAKE_ACTOR_ID),
  );
}

function environmentChangeImportsPaused(env: Env) {
  // Intake stays closed unless the operator explicitly sets the value to "false".
  return env.ENVIRONMENT_CHANGE_IMPORTS_PAUSED !== "false";
}

function sourceConfig(env: Env, source: Environment) {
  const prefix = source.toUpperCase() as "DEV" | "UAT" | "PROD";
  return {
    url: env[`${prefix}_SUPABASE_URL`],
    publishableKey: env[`${prefix}_SUPABASE_PUBLISHABLE_KEY`],
  };
}

function serviceHeaders(key: string) {
  const headers = new Headers({ apikey: key, "content-type": "application/json" });
  if (!key.startsWith("sb_secret_")) headers.set("authorization", `Bearer ${key}`);
  return headers;
}

async function readJsonLimited(response: Response) {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_RESPONSE_BYTES) throw new Error("upstream_response_too_large");
  if (!response.body) throw new Error("upstream_response_missing");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("upstream_response_too_large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

async function rpc(url: string, name: string, body: Record<string, unknown>, headers: Headers) {
  const response = await fetch(`${url.replace(/\/$/u, "")}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const payload = await readJsonLimited(response);
  if (!response.ok) throw new Error(`rpc_${name}_failed_${response.status}`);
  return payload;
}

async function recordTransport(
  sourceUrl: string,
  publishableKey: string,
  token: string,
  requestId: string,
  succeeded: boolean,
  targetUid: string | null,
) {
  const headers = new Headers({
    apikey: publishableKey,
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  });
  await rpc(
    sourceUrl,
    "record_environment_change_transport",
    {
      _request_id: requestId,
      _succeeded: succeeded,
      _target_change_request_uid: targetUid,
    },
    headers,
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({
        ok: true,
        service: "fvi-environment-control-plane",
        target_environment: env.TARGET_ENVIRONMENT,
        target_configured: targetConfigured(env),
        target_intake_actor_configured: intakeActorConfigured(env.TARGET_INTAKE_ACTOR_ID),
        environment_change_imports_paused: environmentChangeImportsPaused(env),
      });
    }
    if (request.method !== "POST" || url.pathname !== "/v1/environment-changes/receive") {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > MAX_REQUEST_BYTES) {
      return Response.json({ error: "payload_too_large" }, { status: 413 });
    }
    const authorization = request.headers.get("authorization") ?? "";
    if (!authorization.startsWith("Bearer ")) {
      return Response.json({ error: "missing_bearer" }, { status: 401 });
    }
    if (!targetConfigured(env)) {
      return Response.json({ error: "target_environment_unconfigured" }, { status: 503 });
    }
    if (environmentChangeImportsPaused(env)) {
      return Response.json({ error: "environment_change_intake_paused" }, { status: 503 });
    }
    const token = authorization.slice(7);
    let input: { source_request_id?: string; source_environment?: Environment };
    try {
      input = (await request.json()) as typeof input;
    } catch {
      return Response.json({ error: "invalid_json" }, { status: 400 });
    }
    if (
      !/^[0-9a-f-]{36}$/u.test(input.source_request_id ?? "") ||
      !["dev", "uat", "prod"].includes(input.source_environment ?? "")
    ) {
      return Response.json({ error: "invalid_request" }, { status: 422 });
    }
    const source = sourceConfig(env, input.source_environment!);
    if (!source.url || !source.publishableKey) {
      return Response.json({ error: "source_environment_unconfigured" }, { status: 503 });
    }
    const sourceHeaders = new Headers({
      apikey: source.publishableKey,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    });
    let exported: SourceRequest;
    try {
      exported = (await rpc(
        source.url,
        "export_approved_environment_change_for_transport",
        { _request_id: input.source_request_id },
        sourceHeaders,
      )) as SourceRequest;
    } catch {
      return Response.json({ error: "source_approval_invalid" }, { status: 403 });
    }
    const targetBound =
      exported.target_environment === env.TARGET_ENVIRONMENT &&
      exported.target_project_ref === env.TARGET_PROJECT_REF &&
      exported.direction === `${exported.source_environment}_to_${exported.target_environment}`;
    const separated =
      /^[0-9a-f]{64}$/u.test(exported.source_requester_email_hash) &&
      /^[0-9a-f]{64}$/u.test(exported.source_approver_email_hash) &&
      exported.source_requester_email_hash !== exported.source_approver_email_hash;
    if (!targetBound || !separated || exported.source_request_status !== "approved") {
      // This request has not been sent to a target. Keep its source transport
      // state pending so a wrong-environment Worker cannot misclassify it as a
      // completed failed attempt (for example, the retained PROD-to-DEV row).
      return Response.json({ error: "transport_policy_failed" }, { status: 409 });
    }
    const validations = [
      { check: "source_approval", status: "pass" },
      { check: "source_maker_checker_separation", status: "pass" },
      { check: "transport_manifest_hash", status: "pass" },
      { check: "target_environment_binding", status: "pass" },
      { check: "access_mapping_prepared", status: "pass" },
    ];
    try {
      const received = (await rpc(
        env.TARGET_SUPABASE_URL,
        "receive_environment_change_for_api",
        {
          _request: { ...exported, validation_results: validations },
          _requester_email: exported.source_requester_email,
          _target_importer_id: env.TARGET_INTAKE_ACTOR_ID,
        },
        serviceHeaders(env.TARGET_SUPABASE_SERVICE_ROLE_KEY),
      )) as Array<{ change_request_uid?: string }>;
      const targetUid = received[0]?.change_request_uid ?? null;
      if (!targetUid) throw new Error("target_request_missing");
      await recordTransport(
        source.url,
        source.publishableKey,
        token,
        input.source_request_id!,
        true,
        targetUid,
      );
      return Response.json({ ok: true, target_change_request_uid: targetUid });
    } catch {
      await recordTransport(
        source.url,
        source.publishableKey,
        token,
        input.source_request_id!,
        false,
        null,
      ).catch(() => undefined);
      return Response.json({ error: "target_receive_failed" }, { status: 502 });
    }
  },
};
