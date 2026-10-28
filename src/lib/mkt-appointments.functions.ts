import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { assertMktRole, assertMktRoleAssignment } from "./mkt-admin.functions";
import { MKT_PII_READ_ROLES, MKT_TAB_ROLES } from "./mkt-admin-roles";

/* ----------------------------- Types --------------------------------- */

export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type Availability = Record<DayKey, string[]>; // "HH:MM-HH:MM" windows

export type ApptType = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  duration_min: number;
  is_active: boolean;
  timezone: string;
  buffer_before_min: number;
  buffer_after_min: number;
  min_notice_hours: number;
  max_advance_days: number;
  daily_cap: number;
  slot_step_min: number;
  requires_approval: boolean;
  location: string | null;
  meeting_link_template: string | null;
  availability: Availability;
  confirmation_subject: string;
  confirmation_body: string;
  booking_instructions: string | null;
};

export type BookedAppt = {
  id: string;
  type_id: string;
  start_at: string;
  end_at: string;
  status: string;
  attendee_email: string | null;
  attendee_name: string | null;
  notes: string | null;
};

/* --------------------------- Defaults -------------------------------- */

export const DEFAULT_AVAILABILITY: Availability = {
  mon: ["09:00-17:00"],
  tue: ["09:00-17:00"],
  wed: ["09:00-17:00"],
  thu: ["09:00-17:00"],
  fri: ["09:00-17:00"],
  sat: [],
  sun: [],
};

export const APPT_DEFAULTS = {
  duration_min: 30,
  timezone: "UTC",
  buffer_before_min: 0,
  buffer_after_min: 15,
  min_notice_hours: 4,
  max_advance_days: 30,
  daily_cap: 8,
  slot_step_min: 30,
  requires_approval: false,
  is_active: true,
  confirmation_subject: "Your ReconIQ session is confirmed",
  confirmation_body:
    "Hi {{first_name}},\n\nYour {{type_name}} with ReconIQ is confirmed for {{when_local}} ({{timezone}}).\n\nWe'll send the calendar invite and joining details separately.\n\n— The ReconIQ team",
} as const;

/* --------------------------- Validation ------------------------------ */

const timeWindowRe = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;

const availabilitySchema = z.object({
  mon: z.array(z.string().regex(timeWindowRe)).max(4),
  tue: z.array(z.string().regex(timeWindowRe)).max(4),
  wed: z.array(z.string().regex(timeWindowRe)).max(4),
  thu: z.array(z.string().regex(timeWindowRe)).max(4),
  fri: z.array(z.string().regex(timeWindowRe)).max(4),
  sat: z.array(z.string().regex(timeWindowRe)).max(4),
  sun: z.array(z.string().regex(timeWindowRe)).max(4),
});

const apptTypeInput = z.object({
  id: z.string().uuid().optional(),
  slug: z.string().min(1).max(60).regex(/^[a-z0-9_]+$/, "lowercase letters, digits, underscore only"),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional().nullable(),
  duration_min: z.number().int().min(5).max(240),
  is_active: z.boolean(),
  timezone: z.string().min(1).max(64),
  buffer_before_min: z.number().int().min(0).max(120),
  buffer_after_min: z.number().int().min(0).max(120),
  min_notice_hours: z.number().int().min(0).max(720),
  max_advance_days: z.number().int().min(1).max(365),
  daily_cap: z.number().int().min(1).max(100),
  slot_step_min: z.number().int().min(5).max(120),
  requires_approval: z.boolean(),
  location: z.string().max(200).optional().nullable(),
  meeting_link_template: z.string().max(400).optional().nullable(),
  availability: availabilitySchema,
  confirmation_subject: z.string().min(1).max(200),
  confirmation_body: z.string().min(1).max(4000),
  booking_instructions: z.string().max(2000).optional().nullable(),
});

export type ApptTypeInput = z.infer<typeof apptTypeInput>;

/* --------------------------- Read APIs ------------------------------- */

export const listApptTypes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }): Promise<ApptType[]> => {
    await assertMktRole(context, MKT_TAB_ROLES.appointments);
    const { data, error } = await context.supabase
      .from("mkt_appointment_types")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .select("*" as any)
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);
    return ((data ?? []) as unknown as Record<string, unknown>[]).map(normalizeType);
  });

/* --------------------------- Write APIs ------------------------------ */

export const upsertApptType = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => apptTypeInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertMktRole(context, MKT_TAB_ROLES.appointments);
    let before: unknown = null;
    if (data.id) {
      const { data: existing } = await context.supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from("mkt_appointment_types").select("*" as any).eq("id", data.id).maybeSingle();
      before = existing ?? null;
    }
    const { data: row, error } = await context.supabase
      .from("mkt_appointment_types")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .upsert(data as any, { onConflict: "slug" })
      .select("id").single();
    if (error) throw new Error(error.message);
    const { logMktChange } = await import("./mkt-audit.server");
    await logMktChange({
      entity_type: "appointment_type",
      entity_key: row.id,
      action: before ? "update" : "create",
      actor_id: context.userId,
      actor_email: (context.claims as { email?: string } | undefined)?.email ?? null,
      before: before as never,
      after: { ...data, id: row.id } as never,
      summary: `${before ? "Updated" : "Created"} appointment type "${data.name}"`,
    });
    return { id: row.id };
  });

export const deleteApptType = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMktRole(context, MKT_TAB_ROLES.appointments);
    const { data: existing } = await context.supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("mkt_appointment_types").select("*" as any).eq("id", data.id).maybeSingle();
    const { error } = await context.supabase
      .from("mkt_appointment_types").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    if (existing) {
      const { logMktChange } = await import("./mkt-audit.server");
      await logMktChange({
        entity_type: "appointment_type",
        entity_key: data.id,
        action: "delete",
        actor_id: context.userId,
        actor_email: (context.claims as { email?: string } | undefined)?.email ?? null,
        before: existing as never,
        after: null,
        summary: `Deleted appointment type "${(existing as { name?: string }).name ?? data.id}"`,
      });
    }
    return { ok: true };
  });

export const listRecentBookings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }): Promise<BookedAppt[]> => {
    await assertMktRoleAssignment(context, MKT_PII_READ_ROLES);
    const { data, error } = await context.supabase
      .from("mkt_appointments")
      .select("id,type_id,start_at,end_at,status,attendee_email,attendee_name,notes")
      .order("start_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return (data ?? []) as BookedAppt[];
  });

/* ------------------------ Availability engine ------------------------ */

const DAYS: DayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function normalizeType(row: Record<string, unknown>): ApptType {
  const rawAvail = (row.availability as Availability | null) ?? DEFAULT_AVAILABILITY;
  return {
    id: row.id as string,
    slug: row.slug as string,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    duration_min: (row.duration_min as number) ?? APPT_DEFAULTS.duration_min,
    is_active: (row.is_active as boolean) ?? true,
    timezone: (row.timezone as string) ?? APPT_DEFAULTS.timezone,
    buffer_before_min: (row.buffer_before_min as number) ?? APPT_DEFAULTS.buffer_before_min,
    buffer_after_min: (row.buffer_after_min as number) ?? APPT_DEFAULTS.buffer_after_min,
    min_notice_hours: (row.min_notice_hours as number) ?? APPT_DEFAULTS.min_notice_hours,
    max_advance_days: (row.max_advance_days as number) ?? APPT_DEFAULTS.max_advance_days,
    daily_cap: (row.daily_cap as number) ?? APPT_DEFAULTS.daily_cap,
    slot_step_min: (row.slot_step_min as number) ?? APPT_DEFAULTS.slot_step_min,
    requires_approval: (row.requires_approval as boolean) ?? false,
    location: (row.location as string | null) ?? null,
    meeting_link_template: (row.meeting_link_template as string | null) ?? null,
    availability: rawAvail,
    confirmation_subject: (row.confirmation_subject as string) ?? APPT_DEFAULTS.confirmation_subject,
    confirmation_body: (row.confirmation_body as string) ?? APPT_DEFAULTS.confirmation_body,
    booking_instructions: (row.booking_instructions as string | null) ?? null,
  };
}

/** Pure helper: enumerate candidate slot start times (UTC ISO) for a type over a date range. */
export function computeCandidateSlots(
  t: ApptType,
  fromISO: string,
  toISO: string,
  now: Date = new Date(),
): string[] {
  const from = new Date(fromISO);
  const to = new Date(toISO);
  const minBookable = new Date(now.getTime() + t.min_notice_hours * 3_600_000);
  const maxBookable = new Date(now.getTime() + t.max_advance_days * 86_400_000);
  const out: string[] = [];
  const cursor = new Date(from);
  cursor.setUTCHours(0, 0, 0, 0);
  while (cursor <= to) {
    const day = DAYS[cursor.getUTCDay()];
    const windows = t.availability[day] ?? [];
    for (const w of windows) {
      const [s, e] = w.split("-");
      const [sh, sm] = s.split(":").map(Number);
      const [eh, em] = e.split(":").map(Number);
      const winStart = new Date(cursor); winStart.setUTCHours(sh, sm, 0, 0);
      const winEnd = new Date(cursor); winEnd.setUTCHours(eh, em, 0, 0);
      for (let ts = winStart.getTime(); ts + t.duration_min * 60_000 <= winEnd.getTime(); ts += t.slot_step_min * 60_000) {
        const slot = new Date(ts);
        if (slot < minBookable || slot > maxBookable) continue;
        out.push(slot.toISOString());
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

export const getPublicAvailability = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({
      slug: z.string().min(1).max(60),
      from: z.string().datetime().optional(),
      days: z.number().int().min(1).max(30).default(7),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("mkt_appointment_types").select("*" as any)
      .eq("slug", data.slug).eq("is_active", true).maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("unknown_or_inactive_type");
    const type = normalizeType(row as unknown as Record<string, unknown>);
    const from = data.from ? new Date(data.from) : new Date();
    const to = new Date(from.getTime() + data.days * 86_400_000);
    const candidates = computeCandidateSlots(type, from.toISOString(), to.toISOString());

    // Exclude already-booked slots (confirmed or pending)
    const { data: booked } = await supabaseAdmin
      .from("mkt_appointments")
      .select("start_at,end_at,status")
      .eq("type_id", type.id)
      .in("status", ["confirmed", "pending"])
      .gte("start_at", from.toISOString())
      .lte("start_at", to.toISOString());

    const taken = new Set((booked ?? []).map((b) => new Date(b.start_at).toISOString()));
    const free = candidates.filter((iso) => !taken.has(iso));

    // Also enforce daily cap
    const perDay: Record<string, number> = {};
    for (const b of booked ?? []) {
      const d = new Date(b.start_at).toISOString().slice(0, 10);
      perDay[d] = (perDay[d] ?? 0) + 1;
    }
    const filtered = free.filter((iso) => (perDay[iso.slice(0, 10)] ?? 0) < type.daily_cap);

    return {
      type: {
        slug: type.slug, name: type.name, duration_min: type.duration_min,
        timezone: type.timezone, requires_approval: type.requires_approval,
        location: type.location, booking_instructions: type.booking_instructions,
      },
      slots: filtered,
    };
  });
