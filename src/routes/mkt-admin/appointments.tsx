import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { assertMktRolesFn } from "@/lib/mkt-admin.functions";
import {
  listApptTypes,
  upsertApptType,
  deleteApptType,
  listRecentBookings,
  APPT_DEFAULTS,
  DEFAULT_AVAILABILITY,
  type ApptType,
  type Availability,
  type DayKey,
} from "@/lib/mkt-appointments.functions";
import { MKT_TAB_ROLES } from "@/lib/mkt-admin-roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { CalendarClock, Plus, Trash2, Save, Info, Clock, ShieldAlert, Mail } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/mkt-admin/appointments")({
  beforeLoad: async () => {
    try {
      await assertMktRolesFn({ data: { allowed: MKT_TAB_ROLES.appointments } });
    } catch {
      throw redirect({ to: "/mkt-admin" });
    }
  },
  component: Appointments,
});

const DAY_LABELS: Record<DayKey, string> = {
  mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun",
};
const DAY_ORDER: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

const COMMON_TZS = [
  "UTC", "Europe/London", "Europe/Paris", "Europe/Frankfurt", "Asia/Dubai",
  "Asia/Singapore", "Asia/Tokyo", "Asia/Kolkata",
  "America/New_York", "America/Chicago", "America/Los_Angeles",
];

type Draft = {
  id?: string;
  slug: string;
  name: string;
  description: string;
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
  location: string;
  meeting_link_template: string;
  availability: Availability;
  confirmation_subject: string;
  confirmation_body: string;
  booking_instructions: string;
};

const EMPTY_DRAFT: Draft = {
  slug: "",
  name: "",
  description: "",
  duration_min: APPT_DEFAULTS.duration_min,
  is_active: APPT_DEFAULTS.is_active,
  timezone: APPT_DEFAULTS.timezone,
  buffer_before_min: APPT_DEFAULTS.buffer_before_min,
  buffer_after_min: APPT_DEFAULTS.buffer_after_min,
  min_notice_hours: APPT_DEFAULTS.min_notice_hours,
  max_advance_days: APPT_DEFAULTS.max_advance_days,
  daily_cap: APPT_DEFAULTS.daily_cap,
  slot_step_min: APPT_DEFAULTS.slot_step_min,
  requires_approval: APPT_DEFAULTS.requires_approval,
  location: "",
  meeting_link_template: "",
  availability: DEFAULT_AVAILABILITY,
  confirmation_subject: APPT_DEFAULTS.confirmation_subject,
  confirmation_body: APPT_DEFAULTS.confirmation_body,
  booking_instructions: "",
};

function toDraft(t: ApptType): Draft {
  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    description: t.description ?? "",
    duration_min: t.duration_min,
    is_active: t.is_active,
    timezone: t.timezone,
    buffer_before_min: t.buffer_before_min,
    buffer_after_min: t.buffer_after_min,
    min_notice_hours: t.min_notice_hours,
    max_advance_days: t.max_advance_days,
    daily_cap: t.daily_cap,
    slot_step_min: t.slot_step_min,
    requires_approval: t.requires_approval,
    location: t.location ?? "",
    meeting_link_template: t.meeting_link_template ?? "",
    availability: t.availability,
    confirmation_subject: t.confirmation_subject,
    confirmation_body: t.confirmation_body,
    booking_instructions: t.booking_instructions ?? "",
  };
}

const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
const winRe = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;

function validate(d: Draft): string[] {
  const errs: string[] = [];
  if (!/^[a-z0-9_]+$/.test(d.slug)) errs.push("Slug must be lowercase letters, digits, or underscore.");
  if (!d.name.trim()) errs.push("Name is required.");
  if (d.duration_min < 5 || d.duration_min > 240) errs.push("Duration must be 5–240 minutes.");
  if (d.slot_step_min < 5 || d.slot_step_min > 120) errs.push("Slot step must be 5–120 minutes.");
  if (d.min_notice_hours < 0 || d.min_notice_hours > 720) errs.push("Min notice must be 0–720 hours.");
  if (d.max_advance_days < 1 || d.max_advance_days > 365) errs.push("Booking horizon must be 1–365 days.");
  if (d.daily_cap < 1 || d.daily_cap > 100) errs.push("Daily cap must be 1–100.");
  if (d.buffer_before_min < 0 || d.buffer_before_min > 120) errs.push("Buffer before must be 0–120 minutes.");
  if (d.buffer_after_min < 0 || d.buffer_after_min > 120) errs.push("Buffer after must be 0–120 minutes.");
  if (!d.confirmation_subject.trim()) errs.push("Confirmation subject is required.");
  if (!d.confirmation_body.trim()) errs.push("Confirmation body is required.");
  const anyDay = DAY_ORDER.some((k) => (d.availability[k] ?? []).length > 0);
  if (!anyDay) errs.push("At least one day must have an availability window.");
  for (const k of DAY_ORDER) {
    for (const w of d.availability[k] ?? []) {
      if (!winRe.test(w)) { errs.push(`${DAY_LABELS[k]}: "${w}" is not a valid HH:MM-HH:MM window.`); continue; }
      const [s, e] = w.split("-");
      if (s >= e) errs.push(`${DAY_LABELS[k]}: window "${w}" ends before it starts.`);
    }
  }
  return errs;
}

function Appointments() {
  const typesFn = useServerFn(listApptTypes);
  const saveFn = useServerFn(upsertApptType);
  const delFn = useServerFn(deleteApptType);
  const bookingsFn = useServerFn(listRecentBookings);
  const qc = useQueryClient();

  const types = useQuery({ queryKey: ["mkt", "appt", "types"], queryFn: () => typesFn({ data: undefined }) });
  const bookings = useQuery({ queryKey: ["mkt", "appt", "bookings"], queryFn: () => bookingsFn({ data: undefined }) });

  const [draft, setDraft] = useState<Draft | null>(null);
  const [tab, setTab] = useState("general");

  const errors = useMemo(() => (draft ? validate(draft) : []), [draft]);

  const save = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error("no draft");
      if (errors.length) throw new Error(errors[0]);
      return saveFn({
        data: {
          id: draft.id,
          slug: draft.slug,
          name: draft.name,
          description: draft.description || null,
          duration_min: draft.duration_min,
          is_active: draft.is_active,
          timezone: draft.timezone,
          buffer_before_min: draft.buffer_before_min,
          buffer_after_min: draft.buffer_after_min,
          min_notice_hours: draft.min_notice_hours,
          max_advance_days: draft.max_advance_days,
          daily_cap: draft.daily_cap,
          slot_step_min: draft.slot_step_min,
          requires_approval: draft.requires_approval,
          location: draft.location || null,
          meeting_link_template: draft.meeting_link_template || null,
          availability: draft.availability,
          confirmation_subject: draft.confirmation_subject,
          confirmation_body: draft.confirmation_body,
          booking_instructions: draft.booking_instructions || null,
        },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mkt", "appt", "types"] });
      toast.success("Appointment type saved");
      setDraft(null);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const del = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mkt", "appt", "types"] });
      toast.success("Deleted");
      setDraft(null);
    },
  });

  const typeById = new Map((types.data ?? []).map((t) => [t.id, t] as const));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold">Appointment settings</h1>
          <p className="text-sm text-muted-foreground">
            Availability, rules, and confirmations for every bookable session. Used by <code>/book-demo</code> and ReconIQ Copilot.
          </p>
        </div>
        <Button onClick={() => { setDraft({ ...EMPTY_DRAFT }); setTab("general"); }}>
          <Plus className="mr-1 h-4 w-4" /> New type
        </Button>
      </div>

      <Card className="p-4">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <CalendarClock className="h-4 w-4" /> Bookable types
        </div>
        {types.isLoading ? (
          <div className="p-4 text-sm text-muted-foreground">Loading…</div>
        ) : (types.data ?? []).length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">No appointment types configured.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="pb-2 pr-3">Name</th>
                  <th className="pb-2 pr-3">Slug</th>
                  <th className="pb-2 pr-3">Duration</th>
                  <th className="pb-2 pr-3">Rules</th>
                  <th className="pb-2 pr-3">Status</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {(types.data ?? []).map((t) => (
                  <tr key={t.id} className="border-t border-border">
                    <td className="py-2 pr-3 font-medium">{t.name}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{t.slug}</td>
                    <td className="py-2 pr-3">{t.duration_min}m</td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground">
                      ≥{t.min_notice_hours}h · ≤{t.max_advance_days}d · cap {t.daily_cap}/day
                      {t.requires_approval ? " · approval" : ""}
                    </td>
                    <td className="py-2 pr-3">
                      {t.is_active ? <span className="text-green-800 dark:text-green-300">Active</span> : <span className="text-muted-foreground">Disabled</span>}
                    </td>
                    <td className="py-2 text-right">
                      <Button size="sm" variant="ghost" onClick={() => { setDraft(toDraft(t)); setTab("general"); }}>Edit</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {draft && (
        <Card className="p-4">
          <form
            className="space-y-4"
            onSubmit={(e) => { e.preventDefault(); save.mutate(); }}
          >
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">{draft.id ? `Edit "${draft.name || draft.slug}"` : "New appointment type"}</div>
              <div className="flex items-center gap-2 text-xs">
                <Switch id="is_active" checked={draft.is_active} onCheckedChange={(v) => setDraft({ ...draft, is_active: v })} />
                <Label htmlFor="is_active">Active</Label>
              </div>
            </div>

            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                <TabsTrigger value="general"><Info className="mr-1 h-3.5 w-3.5" /> General</TabsTrigger>
                <TabsTrigger value="availability"><Clock className="mr-1 h-3.5 w-3.5" /> Availability</TabsTrigger>
                <TabsTrigger value="rules"><ShieldAlert className="mr-1 h-3.5 w-3.5" /> Booking rules</TabsTrigger>
                <TabsTrigger value="confirmation"><Mail className="mr-1 h-3.5 w-3.5" /> Confirmation</TabsTrigger>
              </TabsList>

              <TabsContent value="general" className="mt-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Slug">
                    <Input value={draft.slug} onChange={(e) => setDraft({ ...draft, slug: e.target.value })} placeholder="product_demo" />
                    <Hint>Lowercase letters, digits, underscore. Used in URLs and by the chatbot.</Hint>
                  </Field>
                  <Field label="Name">
                    <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Product demo" />
                  </Field>
                  <Field label="Duration (minutes)">
                    <Input type="number" min={5} max={240} value={draft.duration_min}
                      onChange={(e) => setDraft({ ...draft, duration_min: Number(e.target.value || 0) })} />
                  </Field>
                  <Field label="Timezone">
                    <Select value={draft.timezone} onValueChange={(v) => setDraft({ ...draft, timezone: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {COMMON_TZS.map((tz) => <SelectItem key={tz} value={tz}>{tz}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Location (optional)">
                    <Input value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })}
                      placeholder="Virtual · Google Meet" />
                  </Field>
                  <Field label="Meeting link template (optional)">
                    <Input value={draft.meeting_link_template}
                      onChange={(e) => setDraft({ ...draft, meeting_link_template: e.target.value })}
                      placeholder="https://meet.example.com/{{booking_id}}" />
                  </Field>
                </div>
                <Field label="Description" className="mt-3">
                  <Textarea rows={2} value={draft.description}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
                </Field>
                <Field label="Booking instructions (shown to attendee)" className="mt-3">
                  <Textarea rows={2} value={draft.booking_instructions}
                    onChange={(e) => setDraft({ ...draft, booking_instructions: e.target.value })}
                    placeholder="Have your reconciliation KPIs handy." />
                </Field>
              </TabsContent>

              <TabsContent value="availability" className="mt-4 space-y-3">
                <Hint>Set weekly windows in <b>{draft.timezone}</b> using 24-hour HH:MM-HH:MM. Empty = day off.</Hint>
                <div className="space-y-2">
                  {DAY_ORDER.map((day) => (
                    <DayEditor key={day} day={day}
                      windows={draft.availability[day] ?? []}
                      onChange={(ws) => setDraft({ ...draft, availability: { ...draft.availability, [day]: ws } })} />
                  ))}
                </div>
                <Field label="Slot step (minutes)">
                  <Input type="number" min={5} max={120} value={draft.slot_step_min}
                    onChange={(e) => setDraft({ ...draft, slot_step_min: Number(e.target.value || 0) })} />
                  <Hint>Interval between offered start times inside a window (e.g. 15, 30, 60).</Hint>
                </Field>
              </TabsContent>

              <TabsContent value="rules" className="mt-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Minimum notice (hours)">
                    <Input type="number" min={0} max={720} value={draft.min_notice_hours}
                      onChange={(e) => setDraft({ ...draft, min_notice_hours: Number(e.target.value || 0) })} />
                    <Hint>Attendees cannot book closer than this to the start time.</Hint>
                  </Field>
                  <Field label="Booking horizon (days)">
                    <Input type="number" min={1} max={365} value={draft.max_advance_days}
                      onChange={(e) => setDraft({ ...draft, max_advance_days: Number(e.target.value || 0) })} />
                    <Hint>How far ahead attendees can book.</Hint>
                  </Field>
                  <Field label="Daily cap">
                    <Input type="number" min={1} max={100} value={draft.daily_cap}
                      onChange={(e) => setDraft({ ...draft, daily_cap: Number(e.target.value || 0) })} />
                    <Hint>Max confirmed/pending bookings per calendar day for this type.</Hint>
                  </Field>
                  <Field label="Buffer before (minutes)">
                    <Input type="number" min={0} max={120} value={draft.buffer_before_min}
                      onChange={(e) => setDraft({ ...draft, buffer_before_min: Number(e.target.value || 0) })} />
                  </Field>
                  <Field label="Buffer after (minutes)">
                    <Input type="number" min={0} max={120} value={draft.buffer_after_min}
                      onChange={(e) => setDraft({ ...draft, buffer_after_min: Number(e.target.value || 0) })} />
                  </Field>
                  <Field label="Requires approval">
                    <div className="flex items-center gap-2 pt-2">
                      <Switch checked={draft.requires_approval}
                        onCheckedChange={(v) => setDraft({ ...draft, requires_approval: v })} />
                      <span className="text-xs text-muted-foreground">
                        Bookings land as <b>pending</b> and need admin confirmation before invites go out.
                      </span>
                    </div>
                  </Field>
                </div>
              </TabsContent>

              <TabsContent value="confirmation" className="mt-4 space-y-3">
                <Field label="Confirmation subject">
                  <Input value={draft.confirmation_subject}
                    onChange={(e) => setDraft({ ...draft, confirmation_subject: e.target.value })} />
                </Field>
                <Field label="Confirmation body">
                  <Textarea rows={10} value={draft.confirmation_body}
                    onChange={(e) => setDraft({ ...draft, confirmation_body: e.target.value })} />
                  <Hint>
                    Tokens: <code>{"{{first_name}}"}</code>, <code>{"{{attendee_name}}"}</code>,{" "}
                    <code>{"{{type_name}}"}</code>, <code>{"{{when_local}}"}</code>,{" "}
                    <code>{"{{timezone}}"}</code>, <code>{"{{location}}"}</code>.
                  </Hint>
                </Field>
              </TabsContent>
            </Tabs>

            {errors.length > 0 && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                <div className="mb-1 font-semibold">Fix before saving:</div>
                <ul className="list-inside list-disc space-y-0.5">
                  {errors.slice(0, 6).map((e) => <li key={e}>{e}</li>)}
                </ul>
              </div>
            )}

            <div className="flex items-center gap-2">
              <Button type="submit" disabled={save.isPending || errors.length > 0}>
                <Save className="mr-1 h-4 w-4" /> {save.isPending ? "Saving…" : "Save"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
              {draft.id && (
                <Button type="button" variant="destructive" className="ml-auto"
                  disabled={del.isPending}
                  onClick={() => { if (draft.id && confirm(`Delete "${draft.name}"?`)) del.mutate(draft.id); }}>
                  <Trash2 className="mr-1 h-4 w-4" /> Delete
                </Button>
              )}
            </div>
          </form>
        </Card>
      )}

      <Card className="p-4">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <CalendarClock className="h-4 w-4" /> Recent bookings
        </div>
        {bookings.isLoading ? (
          <div className="p-4 text-sm text-muted-foreground">Loading…</div>
        ) : (bookings.data ?? []).length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            <Info className="mr-1 inline h-3 w-3" /> No bookings yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="pb-2 pr-3">When</th>
                  <th className="pb-2 pr-3">Type</th>
                  <th className="pb-2 pr-3">Attendee</th>
                  <th className="pb-2 pr-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {(bookings.data ?? []).map((b) => {
                  const t = typeById.get(b.type_id);
                  return (
                    <tr key={b.id} className="border-t border-border">
                      <td className="py-2 pr-3">{new Date(b.start_at).toLocaleString()}</td>
                      <td className="py-2 pr-3">{t?.name ?? b.type_id}</td>
                      <td className="py-2 pr-3">
                        <div>{b.attendee_name ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">{b.attendee_email ?? ""}</div>
                      </td>
                      <td className="py-2 pr-3">
                        <span className={b.status === "confirmed" ? "text-green-600" :
                          b.status === "pending" ? "text-amber-600" : "text-muted-foreground"}>
                          {b.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label className="mb-1 block text-xs">{label}</Label>
      {children}
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <div className="mt-1 text-[11px] text-muted-foreground">{children}</div>;
}

function DayEditor({ day, windows, onChange }: {
  day: DayKey; windows: string[]; onChange: (ws: string[]) => void;
}) {
  const setWin = (idx: number, patch: Partial<{ start: string; end: string }>) => {
    const parts = (windows[idx] ?? "09:00-17:00").split("-");
    const start = patch.start ?? parts[0] ?? "09:00";
    const end = patch.end ?? parts[1] ?? "17:00";
    const next = [...windows];
    next[idx] = `${start}-${end}`;
    onChange(next);
  };
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 p-2">
      <div className="w-10 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{DAY_LABELS[day]}</div>
      {windows.length === 0 ? (
        <span className="text-xs text-muted-foreground">Off</span>
      ) : (
        windows.map((w, i) => {
          const [s, e] = w.split("-");
          const bad = !winRe.test(w) || !timeRe.test(s) || !timeRe.test(e);
          return (
            <div key={i} className="flex items-center gap-1">
              <Input value={s} onChange={(ev) => setWin(i, { start: ev.target.value })}
                className={`h-8 w-20 ${bad ? "border-destructive" : ""}`} />
              <span className="text-muted-foreground">–</span>
              <Input value={e} onChange={(ev) => setWin(i, { end: ev.target.value })}
                className={`h-8 w-20 ${bad ? "border-destructive" : ""}`} />
              <Button type="button" variant="ghost" size="sm" className="h-8 px-2"
                onClick={() => onChange(windows.filter((_, j) => j !== i))}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          );
        })
      )}
      <Button type="button" variant="outline" size="sm" className="h-8"
        disabled={windows.length >= 4}
        onClick={() => onChange([...windows, "09:00-17:00"])}>
        <Plus className="mr-1 h-3.5 w-3.5" /> Window
      </Button>
      {windows.length > 0 && (
        <Button type="button" variant="ghost" size="sm" className="h-8 text-xs"
          onClick={() => onChange([])}>Clear</Button>
      )}
    </div>
  );
}
