import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";

type AuthenticatedSupabase = SupabaseClient<Database>;
type ScheduleWriterAction = "edit" | "manage";

function normalizedConfigKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isJsonObject(value: unknown): value is { [key: string]: Json | undefined } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isSecretConfigKey(key: string): boolean {
  const normalized = normalizedConfigKey(key);
  if (/(ref|id|fingerprint|sha256)$/.test(normalized)) return false;
  return normalized === "auth" || normalized === "key" || normalized === "sig" ||
    normalized === "sas" || /(password|passwd|passphrase|secret|privatekey|apikey|accesskey|token|authorization|bearer|credential|signature)/.test(normalized);
}

function isUrlConfigKey(key: string): boolean {
  const normalized = normalizedConfigKey(key);
  return normalized === "url" || normalized.endsWith("url") || normalized === "endpoint";
}

function hasUrlCredentials(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password) return true;
    for (const key of url.searchParams.keys()) {
      if (isSecretConfigKey(key)) return true;
    }
    return false;
  } catch {
    return true;
  }
}

function redactUrl(value: string): { value: string; sensitive: boolean } {
  try {
    const url = new URL(value);
    let sensitive = false;
    if (url.username || url.password) {
      url.username = "";
      url.password = "";
      sensitive = true;
    }
    for (const key of [...url.searchParams.keys()]) {
      if (isSecretConfigKey(key)) {
        url.searchParams.delete(key);
        sensitive = true;
      }
    }
    return { value: sensitive ? "" : value, sensitive };
  } catch {
    return { value: "", sensitive: true };
  }
}

export function redactScheduleConfigForEditor(config: unknown): {
  config: Json;
  sensitive_config_present: boolean;
  sensitive_headers_present: boolean;
  sensitive_url_present: boolean;
} {
  let sensitivePresent = false;
  let sensitiveHeadersPresent = false;
  let sensitiveUrlPresent = false;
  const visit = (value: Json, parentKey = ""): Json => {
    // Header names are tenant-defined; a credential may use an arbitrary name.
    // Never send saved header values to the browser, even to a writer.
    if (normalizedConfigKey(parentKey) === "headers") {
      sensitivePresent = true;
      sensitiveHeadersPresent = true;
      return Array.isArray(value) ? [] : typeof value === "string" ? "" : {};
    }
    if (Array.isArray(value)) return value.map((item) => visit(item, parentKey));
    if (typeof value !== "object" || value === null) {
      if (typeof value === "string" && isUrlConfigKey(parentKey)) {
        const redacted = redactUrl(value);
        sensitivePresent ||= redacted.sensitive;
        sensitiveUrlPresent ||= redacted.sensitive;
        return redacted.value;
      }
      return value;
    }

    const result: { [key: string]: Json | undefined } = {};
    for (const [key, child] of Object.entries(value)) {
      if (child === undefined) continue;
      if (isSecretConfigKey(key)) {
        sensitivePresent ||= child !== null && child !== undefined && child !== "";
        if (normalizedConfigKey(parentKey) === "headers" && child !== null && child !== undefined && child !== "") {
          sensitiveHeadersPresent = true;
        }
        continue;
      }
      result[key] = visit(child, key);
    }
    return result;
  };

  const safeConfig = visit((config ?? {}) as Json);
  return {
    config: typeof safeConfig === "object" && safeConfig !== null
      ? safeConfig
      : {},
    sensitive_config_present: sensitivePresent,
    sensitive_headers_present: sensitiveHeadersPresent,
    sensitive_url_present: sensitiveUrlPresent,
  };
}

function mergeScheduleConfigPreservingSensitiveValues(
  existing: Json,
  submitted: Json,
): Json {
  if (Array.isArray(submitted)) {
    const existingArray = Array.isArray(existing) ? existing : [];
    return submitted.map((value, index) => {
      const oldValue = existingArray[index];
      return oldValue === undefined ? value : mergeScheduleConfigPreservingSensitiveValues(oldValue, value);
    });
  }
  if (typeof submitted !== "object" || submitted === null) return submitted;
  const oldObject = isJsonObject(existing)
    ? existing
    : {};
  const newObject = submitted as { [key: string]: Json | undefined };
  const merged: { [key: string]: Json | undefined } = {};

  for (const [key, value] of Object.entries(newObject)) {
    if (value === undefined) continue;
    if (isSecretConfigKey(key)) continue;
    const oldValue = oldObject[key];
    if (normalizedConfigKey(key) === "headers" && oldValue !== undefined) {
      const submittedHeaders = typeof value === "string" ? value.trim() : JSON.stringify(value);
      if (submittedHeaders !== "" && submittedHeaders !== "{}" && submittedHeaders !== "[]") {
        throw new Error("Saved connection headers cannot be changed here. Use the approved credential-management workflow.");
      }
      merged[key] = oldValue;
      continue;
    }
    if (isUrlConfigKey(key) && typeof oldValue === "string" && hasUrlCredentials(oldValue)) {
      merged[key] = oldValue;
      continue;
    }
    merged[key] = oldValue === undefined
      ? value
      : mergeScheduleConfigPreservingSensitiveValues(oldValue, value);
  }
  for (const [key, value] of Object.entries(oldObject)) {
    if (isSecretConfigKey(key)) merged[key] = value;
    else if (!(key in newObject) && (normalizedConfigKey(key) === "headers" || (isUrlConfigKey(key) && typeof value === "string" && hasUrlCredentials(value)))) {
      merged[key] = value;
    }
  }
  return merged;
}

export async function assertActiveScheduleWriter(
  supabase: AuthenticatedSupabase,
  userId: string,
  tenantId: string,
  action: ScheduleWriterAction,
): Promise<void> {
  const { data: member, error } = await supabase
    .from("tenant_members")
    .select("role, active")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("active", true)
    .maybeSingle();

  if (
    error ||
    !member?.active ||
    (member.role !== "tenant_admin" && member.role !== "tenant_analyst")
  ) {
    throw new Error(`You do not have permission to ${action} this connection.`);
  }
}

export async function readScheduleSettingsForEditor(
  supabase: AuthenticatedSupabase,
  userId: string,
  tenantId: string,
  scheduleId: string,
) {
  await assertActiveScheduleWriter(supabase, userId, tenantId, "edit");

  const { data, error } = await supabase
    .from("data_source_schedules")
    .select(
      "id,tenant_id,data_source_id,name,connector_type,config,transformation,cron_expression,enabled",
    )
    .eq("id", scheduleId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    throw new Error("Connection settings are temporarily unavailable. Please try again.");
  }
  if (!data) throw new Error("Connection could not be found.");
  if (!isJsonObject(data.config)) {
    throw new Error("Connection settings require review before they can be edited.");
  }
  const safeConfig = redactScheduleConfigForEditor(data.config);
  return { ...data, ...safeConfig };
}

export async function preserveExistingScheduleCredentials(
  supabase: AuthenticatedSupabase,
  userId: string,
  tenantId: string,
  scheduleId: string,
  submittedConfig: Json,
): Promise<Json> {
  await assertActiveScheduleWriter(supabase, userId, tenantId, "edit");
  const { data, error } = await supabase
    .from("data_source_schedules")
    .select("config")
    .eq("id", scheduleId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new Error("Connection could not be saved. Please try again.");
  if (!data) throw new Error("Connection could not be found.");
  if (!isJsonObject(data.config) || !isJsonObject(submittedConfig)) {
    throw new Error("Connection settings require review before they can be edited.");
  }
  return mergeScheduleConfigPreservingSensitiveValues(data.config, submittedConfig);
}
