import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { statusCellSchema, statusHealthSchema, statusDaySchema, publicIncidentSchema, measuredState, overallState, type PublicStatusIncident, type StatusCell, type StatusHealth, type StatusDay, type StatusState } from "@/lib/status.model";
import type { Database } from "@/integrations/supabase/types";
import { verifyStatusToken } from "@/lib/status-token-signing.server";

function publicClient() {
  // LL-078 (Opus 5, 2026-08-23): support both VITE_ (build-time inlined) and
  // unprefixed (runtime Cloudflare Pages env) forms. Same pattern as
  // src/integrations/supabase/client.ts.
  const SUPABASE_URL =
    (import.meta as any).env?.VITE_SUPABASE_URL ||
    process.env.SUPABASE_URL
  const SUPABASE_PUBLISHABLE_KEY =
    (import.meta as any).env?.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    throw new Error(
      `Missing Supabase env vars: ${[
        !SUPABASE_URL ? 'SUPABASE_URL' : '',
        !SUPABASE_PUBLISHABLE_KEY ? 'SUPABASE_PUBLISHABLE_KEY' : '',
      ]
        .filter(Boolean)
        .join(', ')}`,
    )
  }
  return createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  })
}

export type StatusComponent = {
  id: string; key: string; name: string; description: string | null;
  state: "operational" | "degraded_performance" | "partial_outage" | "major_outage" | "maintenance";
  group_name: string | null; display_order: number; updated_at: string;
  state_evidence?: "catalog_declaration_only";
};
export type StatusIncident = PublicStatusIncident;
export type StatusHistoryRow = StatusDay;
export type StatusSnapshot = {
  schema_version: 2;
  overall: StatusState; data_status: "complete" | "partial" | "unavailable";
  components: StatusComponent[]; cells: StatusCell[]; health: StatusHealth[];
  history: StatusDay[]; incidents: PublicStatusIncident[]; generated_at: string;
  history_provenance: "persisted_probe_intervals_only"; legacy_history_used: false;
  truncated: boolean; notifications_ready: boolean;
};
export const EMPTY_STATUS_SNAPSHOT: StatusSnapshot = {
  schema_version: 2,
  overall: "unknown", data_status: "unavailable", components: [], cells: [], health: [],
  history: [], incidents: [], generated_at: "", history_provenance: "persisted_probe_intervals_only",
  legacy_history_used: false, truncated: false, notifications_ready: false,
};

async function safeStatusQuery<T>(run: () => PromiseLike<{ data: T | null; error: unknown }>) {
  try { return await run(); } catch { return { data: null, error: true }; }
}
const publicSnapshotPayload = z.object({
  cells: z.array(statusCellSchema), health: z.array(statusHealthSchema),
  history: z.array(statusDaySchema), incidents: z.array(publicIncidentSchema),
  truncated: z.boolean(), notifications_ready: z.boolean(),
});

/** Reads only safe public projections. Legacy declarations are catalog entries,
 * not probes. Legacy seeded uptime is retained in storage and never counted. */
export async function loadPublicStatusSnapshot(supabase: ReturnType<typeof publicClient>): Promise<StatusSnapshot> {
  const deadline = AbortSignal.timeout(8_000);
  const [catalog, measured] = await Promise.all([
    safeStatusQuery(() => supabase.from("status_components")
      .select("id,key,name,description,state,group_name,display_order,updated_at")
      .order("display_order", { ascending: true }).abortSignal(deadline)),
    safeStatusQuery(() => (supabase as any).rpc("status_public_snapshot").abortSignal(deadline)),
  ]);
  const parsed = publicSnapshotPayload.safeParse(measured.data);
  const measurements = !measured.error && parsed.success ? parsed.data : null;
  const catalogAvailable = !catalog.error && Array.isArray(catalog.data);
  const data_status = !catalogAvailable && !measurements ? "unavailable"
    : !catalogAvailable || !measurements || measurements.truncated ? "partial" : "complete";
  const health = measurements?.health ?? [];
  return {
    ...EMPTY_STATUS_SNAPSHOT,
    data_status, components: catalogAvailable ? (catalog.data as StatusComponent[]).map((component) => ({ ...component, state_evidence: "catalog_declaration_only" as const })) : [],
    cells: measurements?.cells ?? [], health, history: measurements?.history ?? [],
    incidents: measurements?.incidents ?? [], truncated: measurements?.truncated ?? false,
    notifications_ready: measurements?.notifications_ready ?? false,
    overall: overallState(health.map((row) => measuredState(row)), data_status === "complete"),
    generated_at: new Date().toISOString(),
  };
}
export const getPublicStatusSnapshot = createServerFn({ method: "GET" }).handler(async () =>
  loadPublicStatusSnapshot(publicClient())
);
export const getPublicStatusIncidents = createServerFn({ method: "GET" }).handler(async () => {
  const snapshot = await loadPublicStatusSnapshot(publicClient());
  if (snapshot.data_status !== "complete") throw new Error("Incident history is incomplete or unavailable. Try again shortly.");
  return snapshot.incidents;
});

const emailSchema = z.string().trim().toLowerCase().email().max(254);

function randomHex(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Public: register pending consent. Confirmation/unsubscribe capabilities
 * must travel through verified private delivery, never in a public response.
 * This lane performs no email sends; parent QA must qualify delivery first. */
export const subscribeToStatus = createServerFn({ method: "POST" })
  .validator((d) => z.object({
    email: emailSchema,
    component_keys: z.array(z.string().regex(/^[a-z0-9_-]{1,40}$/)).max(20).default([]),
  }).parse(d))
  .handler(async ({ data }) => {
    const supabase = publicClient();
    const confirmHex = randomHex();
    const unsubHex = randomHex();
    const { error } = await supabase.rpc("status_subscribe", {
      _email: data.email,
      _component_keys: data.component_keys,
      _confirm_token: confirmHex,
      _unsub_token: unsubHex,
    }).abortSignal(AbortSignal.timeout(8_000));
    if (error) throw new Error("The subscription request could not be confirmed. Try again shortly.");
    return { ok: true, consent_state: "pending_confirmation", confirmation_delivery: "not_verified" } as const;
  });

/** Public: confirm subscription via signed token. */
export const confirmStatusSubscription = createServerFn({ method: "POST" })
  .validator((d) => z.object({ token: z.string().min(66).max(130) }).parse(d))
  .handler(async ({ data }) => {
    const supabase = publicClient();
    const hex = await verifyStatusToken(data.token);
    if (!hex) return { ok: false, error: "Invalid or tampered token" } as const;
    const { data: ok, error } = await supabase.rpc("status_confirm_subscriber", { _token: hex })
      .abortSignal(AbortSignal.timeout(8_000));
    if (error) throw new Error(error.message);
    return { ok: !!ok };
  });

/** Public: unsubscribe via signed token. */
export const unsubscribeFromStatus = createServerFn({ method: "POST" })
  .validator((d) => z.object({ token: z.string().min(66).max(130) }).parse(d))
  .handler(async ({ data }) => {
    const supabase = publicClient();
    const hex = await verifyStatusToken(data.token);
    if (!hex) return { ok: false, error: "Invalid or tampered token" } as const;
    const { data: ok, error } = await supabase.rpc("status_unsubscribe", { _token: hex })
      .abortSignal(AbortSignal.timeout(8_000));
    if (error) throw new Error(error.message);
    return { ok: !!ok };
  });
