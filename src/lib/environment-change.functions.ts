import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";

const requestSchema = z
  .object({
    direction: z.enum([
      "dev_to_uat",
      "uat_to_prod",
      "prod_to_uat",
      "uat_to_dev",
      "dev_to_prod",
      "prod_to_dev",
    ]),
    source_tenant_id: z.string().uuid(),
    target_tenant_id: z.string().uuid(),
    title: z.string().trim().min(3).max(120),
    reason: z.string().trim().min(10).max(1000),
    idempotency_key: z.string().trim().min(8).max(128),
  })
  .superRefine((value, context) => {
    const [sourceEnvironment] = value.direction.split("_to_");
    const runtimeRef =
      process.env.SUPABASE_PROJECT_ID ??
      process.env.SUPABASE_URL?.match(/^https:\/\/([a-z]{20})\.supabase\.co\/?$/u)?.[1];
    const expectedRef =
      sourceEnvironment === "dev"
        ? "YOUR_PROJECT_REF"
        : sourceEnvironment === "prod"
          ? "YOUR_PROJECT_REF"
          : null;
    if (!expectedRef || runtimeRef !== expectedRef) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "The request must be submitted from its source environment",
      });
    }
  });

const packageEnvelopeSchema = z.object({
  schema_version: z.literal(1),
  payload: z.string().min(10).max(2_000_000),
  signature: z.string().regex(/^[0-9a-f]{64}$/u),
});

export const listEnvironmentChanges = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) =>
    z.object({ control_tenant_id: z.string().uuid().optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    let query = context.supabase
      .from("environment_change_requests")
      .select(
        "id,change_request_uid,control_tenant_id,direction,source_environment,target_environment,title,status,approval_stage,transport_status,target_change_request_uid,activation_status,access_mapping_preview,package_hash,configuration_hash,settings_hash,manifest_hash,requested_by,requested_at,decided_by,decided_at,execution_id,executed_by,execution_started_at,execution_completed_at,deployment_outcome,failed_components,final_readback_hash",
      )
      .order("requested_at", { ascending: false })
      .limit(100);
    if (data.control_tenant_id) {
      query = query.eq("control_tenant_id", data.control_tenant_id);
    }
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const getEnvironmentChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) =>
    z.object({ id: z.string().uuid(), control_tenant_id: z.string().uuid().optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    let requestQuery = context.supabase
      .from("environment_change_requests")
      .select("*")
      .eq("id", data.id);
    if (data.control_tenant_id) {
      requestQuery = requestQuery.eq("control_tenant_id", data.control_tenant_id);
    }
    const { data: request, error } = await requestQuery.single();
    if (error) throw new Error(error.message);
    const { data: events, error: eventError } = await context.supabase
      .from("environment_change_events")
      .select("id,event_sequence,event_type,actor_user_id,context,occurred_at,prev_hash,row_hash")
      .eq("request_id", data.id)
      .order("event_sequence", { ascending: true });
    if (eventError) throw new Error(eventError.message);
    return { request, events: events ?? [] };
  });

export const requestEnvironmentChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) => requestSchema.parse(input))
  .handler(async ({ data, context }) => {
    const [sourceEnvironment, targetEnvironment] = data.direction.split("_to_") as [
      "dev" | "uat" | "prod",
      "dev" | "uat" | "prod",
    ];
    const { data: environments, error: environmentError } = await context.supabase
      .from("environment_release_registry")
      .select("environment,project_ref,enabled")
      .in("environment", [sourceEnvironment, targetEnvironment]);
    if (environmentError) throw new Error(environmentError.message);
    const environmentMap = new Map(
      (
        (environments ?? []) as Array<{
          environment: string;
          project_ref: string | null;
          enabled: boolean;
        }>
      ).map((environment) => [environment.environment, environment]),
    );
    const source = environmentMap.get(sourceEnvironment);
    const target = environmentMap.get(targetEnvironment);
    if (!source?.enabled || !source.project_ref || !target?.enabled || !target.project_ref) {
      throw new Error(`${targetEnvironment.toUpperCase()} environment is not provisioned`);
    }
    const { buildEnvironmentPackage } = await import("@/lib/environment-package.server");
    const manifest = await buildEnvironmentPackage(context.supabase, data.source_tenant_id);
    const validations = [
      { check: "source_tenant_binding", status: "pass" },
      { check: "secret_free_manifest", status: "pass" },
      {
        check: "package_inventory",
        status: "pass",
        detail: {
          reconciliations: manifest.package.recon_definitions.length,
          data_prep_pipelines: manifest.package.data_prep_pipelines.length,
          data_sources: manifest.configuration.data_sources.length,
          connector_schedules: manifest.configuration.connector_schedules.length,
          watchers: manifest.configuration.watchers.length,
          access_grants: manifest.settings.access_grants.length,
        },
      },
    ];
    const request = {
      ...data,
      source_environment: sourceEnvironment,
      target_environment: targetEnvironment,
      source_project_ref: source.project_ref,
      target_project_ref: target.project_ref,
      manifest,
      validation_results: validations,
    };
    const { data: result, error } = await context.supabase.rpc(
      "request_source_environment_change",
      {
        _request: request as unknown as Json,
      },
    );
    if (error || !result?.[0]) {
      throw new Error(error?.message ?? "Environment change request failed");
    }
    return result[0];
  });

export const decideEnvironmentChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) =>
    z
      .object({
        request_id: z.string().uuid(),
        approve: z.boolean(),
        comment: z.string().trim().max(500).nullable().optional(),
        confirm_access_mapping: z.boolean().default(false),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: target, error: targetError } = await context.supabase
      .from("environment_change_requests")
      .select("approval_stage,source_environment")
      .eq("id", data.request_id)
      .single();
    if (targetError) throw new Error(targetError.message);
    const incoming = (target as { approval_stage?: string }).approval_stage === "target_review";
    if (!incoming && data.approve) {
      const { checkEnvironmentChangeIntake } =
        await import("@/lib/environment-control-plane.server");
      const intake = await checkEnvironmentChangeIntake();
      if (intake !== "open") {
        throw new Error(
          intake === "paused"
            ? "Environment package intake is temporarily paused."
            : "Environment package intake is unavailable.",
        );
      }
    }
    const { data: result, error } = incoming
      ? await context.supabase.rpc("approve_incoming_environment_change", {
          _request_id: data.request_id,
          _approve: data.approve,
          _comment: data.comment ?? "",
          _confirm_access_mapping: data.confirm_access_mapping,
        })
      : await context.supabase.rpc("decide_environment_change", {
          _request_id: data.request_id,
          _approve: data.approve,
          _comment: data.comment ?? "",
        });
    if (error) throw new Error(error.message);
    if (!incoming && data.approve) {
      const authorization = getRequest().headers.get("authorization") ?? "";
      try {
        const { transmitEnvironmentChange } =
          await import("@/lib/environment-control-plane.server");
        const transported = await transmitEnvironmentChange({
          sourceRequestId: data.request_id,
          sourceEnvironment: (target as { source_environment: "dev" | "uat" | "prod" })
            .source_environment,
          authorization,
        });
        return {
          status: result,
          transport_status: "succeeded",
          target_change_request_uid: transported.targetChangeRequestUid,
        };
      } catch (transportError) {
        await context.supabase.rpc("record_environment_change_transport", {
          _request_id: data.request_id,
          _succeeded: false,
          _target_change_request_uid: "",
        });
        return {
          status: result,
          transport_status: "failed",
          transport_error:
            transportError instanceof Error
              ? transportError.message
              : "Environment transport failed",
        };
      }
    }
    return { status: result, transport_status: "not_required" };
  });

export const exportEnvironmentChangePackage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) => z.object({ request_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { exportApprovedPackage } = await import("@/lib/environment-package-file.server");
    return exportApprovedPackage(context.supabase, data.request_id);
  });

export const importEnvironmentChangePackage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) =>
    z
      .object({
        target_tenant_id: z.string().uuid(),
        envelope: packageEnvelopeSchema,
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const [{ data: platformAdmin }, { data: tenantAdmin }] = await Promise.all([
      context.supabase.rpc("is_platform_admin", { _user_id: context.userId }),
      context.supabase.rpc("has_tenant_role", {
        _user_id: context.userId,
        _tenant_id: data.target_tenant_id,
        _role: "tenant_admin",
      }),
    ]);
    if (!platformAdmin && !tenantAdmin) throw new Error("Target tenant administrator is required");
    const { verifyEnvironmentPackage } = await import("@/lib/environment-package-file.server");
    const payload = await verifyEnvironmentPackage(data.envelope);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getRuntimeEnv } = await import("@/lib/runtime-env.server");
    const runtimeRef =
      getRuntimeEnv("SUPABASE_PROJECT_ID") ??
      getRuntimeEnv("SUPABASE_URL")?.match(/^https:\/\/([a-z]{20})\.supabase\.co\/?$/u)?.[1];
    const manifest = payload.manifest as
      | { settings?: { tenant_identity?: Record<string, unknown> } }
      | undefined;
    const claimedIdentity = manifest?.settings?.tenant_identity;
    const { data: targetIdentity, error: identityError } = await supabaseAdmin.rpc(
      "environment_tenant_identity",
      { _tenant_id: data.target_tenant_id },
    );
    if (identityError || !targetIdentity || typeof targetIdentity !== "object") {
      throw new Error("Target tenant release identity is unavailable");
    }
    const actualIdentity = targetIdentity as Record<string, unknown>;
    const identityMismatch =
      !claimedIdentity ||
      claimedIdentity.release_identity_uid !== actualIdentity.release_identity_uid ||
      claimedIdentity.legal_identity_hash !== actualIdentity.legal_identity_hash ||
      claimedIdentity.verified_organization_domain !==
        actualIdentity.verified_organization_domain ||
      claimedIdentity.domain_identity_hash !== actualIdentity.domain_identity_hash;
    const addressMismatch =
      payload.target_project_ref !== runtimeRef ||
      payload.target_tenant_id !== data.target_tenant_id;
    if (addressMismatch || identityMismatch) {
      const incident = {
        reason_code: "environment_package_tenant_mismatch",
        selected_target_tenant_id: data.target_tenant_id,
        claimed_target_tenant_id:
          typeof payload.target_tenant_id === "string" ? payload.target_tenant_id : null,
        source_request_uid:
          typeof payload.upstream_change_request_uid === "string"
            ? payload.upstream_change_request_uid
            : null,
        manifest_hash:
          typeof payload.upstream_manifest_hash === "string"
            ? payload.upstream_manifest_hash
            : null,
        address_mismatch: addressMismatch,
        identity_mismatch: identityMismatch,
        runtime_project_ref: runtimeRef ?? null,
        package_rejected: true,
      };
      const { error: rejectionError } = await supabaseAdmin.rpc(
        "record_environment_package_rejection_for_api",
        {
          _target_tenant_id: data.target_tenant_id,
          _actor_user_id: context.userId,
          _incident: incident,
        },
      );
      if (rejectionError) throw new Error("Package rejected; security incident recording failed");
      throw new Error("Package belongs to a different environment or tenant");
    }
    const validations = [
      { check: "manual_package_signature", status: "pass" },
      { check: "target_environment_binding", status: "pass" },
      { check: "target_tenant_binding", status: "pass" },
      { check: "tenant_family_identity", status: "pass" },
      { check: "verified_organization_domain", status: "pass" },
    ];
    const request = { ...payload, validation_results: validations } as Json;
    const requesterEmail = String(payload.source_requester_email ?? "");
    const { data: received, error } = await supabaseAdmin.rpc(
      "receive_environment_change_for_api",
      { _request: request, _requester_email: requesterEmail, _target_importer_id: context.userId },
    );
    if (error || !received?.[0]) {
      throw new Error(error?.message ?? "Environment package import failed");
    }
    return received[0];
  });
