import type { SupabaseClient } from "@supabase/supabase-js";

const REQUIRED_SCHEMA_VERSIONS = [
  "20260906014500",
  "20260906061500",
  "20260906110000",
  "20260906113000",
  "20260906114500",
  "20260908173000",
  "20260908184500",
  "20260908203000",
  "20260908234500",
  "20260909022500",
  "20260914110000",
];

async function sha256(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Text(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function buildEnvironmentPackage(supabase: SupabaseClient, tenantId: string) {
  const [
    tenant,
    recons,
    pipelines,
    sources,
    schedules,
    watchers,
    members,
    groups,
    permissions,
    flags,
    pages,
  ] = await Promise.all([
    supabase
      .from("tenants")
      .select(
        "id,name,slug,environment,region,allowed_regions,residency_locked,run_retention_days,agent_max_actions,agent_max_distinct_tables,ai_enabled,family_id,tenant_families!inner(release_identity_uid,canonical_legal_name,legal_entity_identifier,verified_organization_domain)",
      )
      .eq("id", tenantId)
      .single(),
    supabase
      .from("recon_definitions")
      .select("id,recon_code,name,description,recon_type,rules,sides,extension,visibility")
      .eq("tenant_id", tenantId)
      .order("name"),
    supabase
      .from("data_prep_pipelines")
      .select(
        "id,public_uid,name,description,source_data_source_id,output_data_source_id,steps,dq_rules,on_failure,enabled,version,lifecycle_state",
      )
      .eq("tenant_id", tenantId)
      .neq("lifecycle_state", "archived")
      .order("name"),
    supabase
      .from("workspace_data_sources")
      .select("id,name,description,source_type,status,inferred_schema,sample_rows,row_count")
      .eq("tenant_id", tenantId)
      .order("name"),
    supabase
      .from("data_source_schedules")
      .select(
        "id,data_source_id,name,connector_type,cron_expression,mode,poll_interval_seconds,transformation,config",
      )
      .eq("tenant_id", tenantId)
      .order("name"),
    supabase
      .from("data_watchers")
      .select("id,data_source_id,name,watch_type,severity,config")
      .eq("tenant_id", tenantId)
      .order("name"),
    supabase
      .from("tenant_members")
      .select("user_id,role")
      .eq("tenant_id", tenantId)
      .eq("active", true),
    supabase.from("tenant_groups").select("id,name,preset_key").eq("tenant_id", tenantId),
    supabase.from("recon_permissions").select("recon_id,principal_type,principal_id,permission"),
    supabase
      .from("tenant_feature_flags")
      .select("feature_key,enabled,config")
      .eq("tenant_id", tenantId)
      .order("feature_key"),
    supabase
      .from("tenant_workspace_page_visibility")
      .select("page_key,enabled")
      .eq("tenant_id", tenantId)
      .order("page_key"),
  ]);
  for (const result of [
    tenant,
    recons,
    pipelines,
    sources,
    schedules,
    watchers,
    members,
    groups,
    permissions,
    flags,
    pages,
  ]) {
    if (result.error) throw new Error(result.error.message);
  }
  if (!tenant.data) throw new Error("Source tenant is unavailable");
  const userIds = (members.data ?? []).map((member) => member.user_id);
  const profiles = userIds.length
    ? await supabase.from("profiles").select("id,email").in("id", userIds)
    : { data: [], error: null };
  if (profiles.error) throw new Error(profiles.error.message);
  const embeddedFamily = Array.isArray(tenant.data.tenant_families)
    ? tenant.data.tenant_families[0]
    : tenant.data.tenant_families;
  if (
    !embeddedFamily?.release_identity_uid ||
    !embeddedFamily.canonical_legal_name ||
    !embeddedFamily.verified_organization_domain
  ) {
    throw new Error("Source tenant has no registered release identity");
  }
  const normalizedLegalName = embeddedFamily.canonical_legal_name
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
  const normalizedLei = embeddedFamily.legal_entity_identifier?.trim().toUpperCase() ?? "";
  const tenantIdentity = {
    release_identity_uid: embeddedFamily.release_identity_uid,
    canonical_legal_name: embeddedFamily.canonical_legal_name,
    legal_entity_identifier: embeddedFamily.legal_entity_identifier,
    verified_organization_domain: embeddedFamily.verified_organization_domain,
    legal_identity_hash: await sha256Text(`${normalizedLegalName}|${normalizedLei}`),
    domain_identity_hash: await sha256Text(embeddedFamily.verified_organization_domain),
  };
  const groupNames = new Map((groups.data ?? []).map((group) => [group.id, group.name]));
  const userEmails = new Map((profiles.data ?? []).map((profile) => [profile.id, profile.email]));
  const reconNames = new Map((recons.data ?? []).map((recon) => [recon.id, recon.name]));
  const accessGrants = (permissions.data ?? []).flatMap((grant) => {
    const principalName =
      grant.principal_type === "group"
        ? groupNames.get(grant.principal_id)
        : userEmails.get(grant.principal_id);
    const reconName = reconNames.get(grant.recon_id);
    return principalName && reconName
      ? [
          {
            recon_source_id: grant.recon_id,
            recon_name: reconName,
            principal_type: grant.principal_type,
            principal_name: principalName,
            permission: grant.permission,
          },
        ]
      : [];
  });
  const connectorSchedules = await Promise.all(
    (schedules.data ?? []).map(async ({ config, ...schedule }) => ({
      ...schedule,
      source_config_hash: await sha256(config),
      credential_binding_required: true,
    })),
  );
  return {
    package: {
      recon_definitions: recons.data ?? [],
      data_prep_pipelines: pipelines.data ?? [],
      required_schema_versions: REQUIRED_SCHEMA_VERSIONS,
    },
    configuration: {
      data_sources: sources.data ?? [],
      connector_schedules: connectorSchedules,
      watchers: watchers.data ?? [],
    },
    settings: {
      tenant: tenant.data,
      tenant_identity: tenantIdentity,
      members: (members.data ?? []).flatMap((member) => {
        const email = userEmails.get(member.user_id);
        return email ? [{ email, role: member.role }] : [];
      }),
      access_grants: accessGrants,
      feature_flags: flags.data ?? [],
      workspace_pages: pages.data ?? [],
    },
  };
}
