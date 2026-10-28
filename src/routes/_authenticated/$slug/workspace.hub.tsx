// Workspace UX Hub — user-facing surface for W-1 … W-28 features.
// Every panel checks its tenant-admin toggle before rendering. Users see only
// what the tenant admin has enabled.
import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { PageContainer } from "@/components/left-rail";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  MessageSquare, ListChecks, Radio, Palette, Bell, KeyRound,
  UserCircle2, Megaphone, Save, ShieldCheck, MonitorSmartphone,
} from "lucide-react";
import { WorkspaceFeaturesProvider, useWorkspaceFeature } from "@/lib/workspace-features";
import {
  listComments, addComment, toggleReaction,
  listTasks, upsertTask, deleteTask,
  getAvailability, setAvailability,
  listAnnouncements, dismissAnnouncement,
  listNotificationPrefs, setNotificationPref,
  listShortcuts, upsertShortcut, deleteShortcut,
  saveDraft, discardDraft, getDraft,
  listThemesCatalog, listMyMentions, markMentionRead,
  updateExtendedProfile, logoutAllDevices, logReadEvent,
  saveDashboardLayout, getDashboardLayout,
} from "@/lib/workspace.functions";

const parent = getRouteApi("/_authenticated/$slug");

export const Route = createFileRoute("/_authenticated/$slug/workspace/hub")({
  head: () => ({
    meta: [
      { title: "Workspace UX Hub — ReconIQ" },
      { name: "description", content: "Personal productivity, collaboration, and preferences hub for ReconIQ workspace users." },
    ],
  }),
  component: WorkspaceHubPage,
});

function WorkspaceHubPage() {
  const { tenant } = parent.useLoaderData() as any;
  const tenantId = tenant?.id as string;
  return (
    <AppShell title="Workspace UX Hub" sidebar={null}>
      <PageContainer>
        <WorkspaceFeaturesProvider tenantId={tenantId}>
          <div className="mb-4">
            <h1 className="text-2xl font-bold">Workspace</h1>
            <p className="text-sm text-muted-foreground">
              Personal productivity, collaboration, and preferences. Availability of each feature is controlled by your tenant administrator.
            </p>
          </div>
          <AnnouncementsBar tenantId={tenantId} />
          <Tabs defaultValue="collab" className="w-full">
            <TabsList className="flex flex-wrap h-auto">
              <TabsTrigger value="collab"><MessageSquare className="w-4 h-4 mr-1" />Collab</TabsTrigger>
              <TabsTrigger value="tasks"><ListChecks className="w-4 h-4 mr-1" />Tasks</TabsTrigger>
              <TabsTrigger value="availability"><Radio className="w-4 h-4 mr-1" />Availability</TabsTrigger>
              <TabsTrigger value="notifications"><Bell className="w-4 h-4 mr-1" />Notifications</TabsTrigger>
              <TabsTrigger value="profile"><UserCircle2 className="w-4 h-4 mr-1" />Profile</TabsTrigger>
              <TabsTrigger value="shortcuts"><KeyRound className="w-4 h-4 mr-1" />Shortcuts</TabsTrigger>
              <TabsTrigger value="themes"><Palette className="w-4 h-4 mr-1" />Themes</TabsTrigger>
              <TabsTrigger value="drafts"><Save className="w-4 h-4 mr-1" />Drafts</TabsTrigger>
              <TabsTrigger value="sessions"><MonitorSmartphone className="w-4 h-4 mr-1" />Sessions</TabsTrigger>
            </TabsList>
            <TabsContent value="collab"><CollabTab tenantId={tenantId} /></TabsContent>
            <TabsContent value="tasks"><TasksTab tenantId={tenantId} /></TabsContent>
            <TabsContent value="availability"><AvailabilityTab tenantId={tenantId} /></TabsContent>
            <TabsContent value="notifications"><NotificationPrefsTab tenantId={tenantId} /></TabsContent>
            <TabsContent value="profile"><ProfileTab /></TabsContent>
            <TabsContent value="shortcuts"><ShortcutsTab tenantId={tenantId} /></TabsContent>
            <TabsContent value="themes"><ThemesTab /></TabsContent>
            <TabsContent value="drafts"><DraftsDemoTab tenantId={tenantId} /></TabsContent>
            <TabsContent value="sessions"><SessionsTab tenantId={tenantId} /></TabsContent>
          </Tabs>
        </WorkspaceFeaturesProvider>
      </PageContainer>
    </AppShell>
  );
}

// ─── Feature-gated empty state ─────────────────────────────────────────────
function DisabledCard({ label }: { label: string }) {
  return (
    <Card className="mt-4">
      <CardContent className="py-8 text-center text-sm text-muted-foreground">
        <ShieldCheck className="w-6 h-6 mx-auto mb-2 opacity-60" />
        <p><span className="font-semibold text-foreground">{label}</span> is disabled by your tenant administrator.</p>
        <p className="text-xs mt-1">Ask a tenant admin to enable it in Tenant Administration → Workspace features.</p>
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════ Announcements ═══════════════════════════════
function AnnouncementsBar({ tenantId }: { tenantId: string }) {
  const enabled = useWorkspaceFeature("announcement_banner");
  const qc = useQueryClient();
  const listFn = useServerFn(listAnnouncements);
  const dismissFn = useServerFn(dismissAnnouncement);
  const { data: items } = useQuery({
    queryKey: ["wan", tenantId], enabled,
    queryFn: () => listFn({ data: { tenantId } }),
  });
  if (!enabled || !items?.length) return null;
  return (
    <div className="space-y-2 mb-3">
      {items.map((a: any) => (
        <Alert key={a.id} variant={a.severity === "critical" ? "destructive" : "default"}>
          <Megaphone className="h-4 w-4" />
          <AlertTitle className="flex items-center justify-between">
            <span>{a.title}</span>
            {a.dismissible && (
              <Button size="sm" variant="ghost" onClick={async () => {
                await dismissFn({ data: { announcementId: a.id } });
                qc.invalidateQueries({ queryKey: ["wan", tenantId] });
              }}>Dismiss</Button>
            )}
          </AlertTitle>
          {a.body && <AlertDescription>{a.body}</AlertDescription>}
        </Alert>
      ))}
    </div>
  );
}

// ═══════════════════════════════ Collab (W-14, W-15) ═════════════════════════
function CollabTab({ tenantId }: { tenantId: string }) {
  const commentsEnabled = useWorkspaceFeature("comments_reactions");
  const mentionsEnabled = useWorkspaceFeature("mentions");
  const listFn = useServerFn(listComments);
  const addFn = useServerFn(addComment);
  const reactFn = useServerFn(toggleReaction);
  const listMentionsFn = useServerFn(listMyMentions);
  const markReadFn = useServerFn(markMentionRead);
  const readLog = useServerFn(logReadEvent);
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const demoResource = { resourceType: "workspace.demo", resourceId: `hub-${tenantId}` };
  const { data: comments } = useQuery({
    queryKey: ["wc", tenantId], enabled: commentsEnabled,
    queryFn: async () => {
      // Read-path audit demo — fires only when the toggle is on server-side.
      readLog({ data: { tenantId, resourceType: demoResource.resourceType, resourceId: demoResource.resourceId, sensitiveClass: "collab.thread" } }).catch(() => {});
      return listFn({ data: { tenantId, ...demoResource } });
    },
  });
  const { data: mentions } = useQuery({
    queryKey: ["wm", tenantId], enabled: mentionsEnabled,
    queryFn: () => listMentionsFn({ data: { tenantId } }),
  });

  if (!commentsEnabled) return <DisabledCard label="Comments & reactions" />;

  const submit = async () => {
    if (!body.trim()) return;
    await addFn({ data: { tenantId, ...demoResource, body, mentions: [] } });
    setBody("");
    qc.invalidateQueries({ queryKey: ["wc", tenantId] });
  };

  return (
    <div className="mt-4 space-y-4">
      {mentionsEnabled && (
        <Card>
          <CardHeader><CardTitle className="text-base">My mentions</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(mentions ?? []).length === 0 && <p className="text-sm text-muted-foreground">No mentions.</p>}
            {(mentions ?? []).map((m: any) => (
              <div key={m.id} className="flex items-center justify-between border-b border-border pb-2">
                <div className="text-sm">
                  <div>{m.source_type} · {m.source_id}</div>
                  <div className="text-xs text-muted-foreground">{new Date(m.created_at).toLocaleString()}</div>
                </div>
                {!m.read_at && (
                  <Button size="sm" variant="outline" onClick={async () => {
                    await markReadFn({ data: { id: m.id } });
                    qc.invalidateQueries({ queryKey: ["wm", tenantId] });
                  }}>Mark read</Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Discussion thread — demo</CardTitle>
          <CardDescription>Attachable comments primitive (reusable on any record).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {(comments ?? []).map((c: any) => (
            <div key={c.id} className="border border-border rounded p-2">
              <div className="text-xs text-muted-foreground">{new Date(c.created_at).toLocaleString()}</div>
              <div className="text-sm">{c.body}</div>
              <div className="flex gap-1 mt-1">
                {["👍","❤️","🎉"].map((e) => (
                  <Button key={e} size="sm" variant="ghost" className="px-2 py-0 h-7"
                    onClick={async () => { await reactFn({ data: { tenantId, commentId: c.id, emoji: e } }); qc.invalidateQueries({ queryKey: ["wc", tenantId] }); }}>
                    {e}
                  </Button>
                ))}
              </div>
            </div>
          ))}
          <div className="flex gap-2">
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write a comment…" />
            <Button onClick={submit}>Post</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ═══════════════════════════════ Tasks (W-16) ════════════════════════════════
function TasksTab({ tenantId }: { tenantId: string }) {
  const enabled = useWorkspaceFeature("task_assignment");
  const listFn = useServerFn(listTasks);
  const upFn = useServerFn(upsertTask);
  const delFn = useServerFn(deleteTask);
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<"low"|"normal"|"high"|"urgent">("normal");
  const { data: tasks } = useQuery({
    queryKey: ["wt", tenantId], enabled,
    queryFn: () => listFn({ data: { tenantId, mine: true } }),
  });
  if (!enabled) return <DisabledCard label="Task assignment" />;
  return (
    <div className="mt-4 space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Add task</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-4 gap-2">
          <Input className="col-span-2" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Select value={priority} onValueChange={(v) => setPriority(v as any)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="normal">Normal</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="urgent">Urgent</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={async () => {
            if (!title.trim()) return;
            await upFn({ data: { tenantId, title, priority, status: "todo" } });
            setTitle("");
            qc.invalidateQueries({ queryKey: ["wt", tenantId] });
          }}>Add</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">My tasks</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(tasks ?? []).length === 0 && <p className="text-sm text-muted-foreground">No tasks assigned to you.</p>}
          {(tasks ?? []).map((t: any) => (
            <div key={t.id} className="flex items-center justify-between border-b border-border pb-2">
              <div>
                <div className="font-semibold">{t.title}</div>
                <div className="text-xs text-muted-foreground">{t.priority} · {t.status}</div>
              </div>
              <div className="flex gap-2">
                <Select value={t.status} onValueChange={async (v) => {
                  await upFn({ data: { id: t.id, tenantId, title: t.title, status: v as any, priority: t.priority } });
                  qc.invalidateQueries({ queryKey: ["wt", tenantId] });
                }}>
                  <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todo">To do</SelectItem>
                    <SelectItem value="in_progress">In progress</SelectItem>
                    <SelectItem value="blocked">Blocked</SelectItem>
                    <SelectItem value="done">Done</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="ghost" size="sm" onClick={async () => {
                  await delFn({ data: { id: t.id } });
                  qc.invalidateQueries({ queryKey: ["wt", tenantId] });
                }}>Delete</Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

// ═══════════════════════════════ Availability (W-17) ═════════════════════════
function AvailabilityTab({ tenantId }: { tenantId: string }) {
  const enabled = useWorkspaceFeature("availability_status");
  const getFn = useServerFn(getAvailability);
  const setFn = useServerFn(setAvailability);
  const qc = useQueryClient();
  const { data: av } = useQuery({
    queryKey: ["wa", tenantId], enabled,
    queryFn: () => getFn({ data: { tenantId } }),
  });
  const [message, setMessage] = useState("");
  useEffect(() => { setMessage((av as any)?.message ?? ""); }, [av]);
  if (!enabled) return <DisabledCard label="Availability status" />;
  return (
    <Card className="mt-4">
      <CardHeader><CardTitle className="text-base">Set my availability</CardTitle></CardHeader>
      <CardContent className="grid grid-cols-3 gap-2 items-end">
        <div>
          <Label>Status</Label>
          <Select value={(av as any)?.status ?? "available"} onValueChange={async (v) => {
            await setFn({ data: { tenantId, status: v as any, message } });
            qc.invalidateQueries({ queryKey: ["wa", tenantId] });
          }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="available">🟢 Available</SelectItem>
              <SelectItem value="busy">🟡 Busy</SelectItem>
              <SelectItem value="dnd">🔴 Do not disturb</SelectItem>
              <SelectItem value="away">⚪ Away</SelectItem>
              <SelectItem value="offline">⚫ Offline</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="col-span-2">
          <Label>Message</Label>
          <div className="flex gap-2">
            <Input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="e.g. In focus block until 3pm" />
            <Button onClick={async () => {
              await setFn({ data: { tenantId, status: ((av as any)?.status ?? "available") as any, message } });
              toast.success("Availability saved");
              qc.invalidateQueries({ queryKey: ["wa", tenantId] });
            }}>Save</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════ Notification prefs (W-9) ════════════════════════
const EVENT_TYPES = ["mention","comment","task.assigned","approval","announcement","secret.rotation"];
const CHANNELS = ["email","sms","push","in_app"] as const;
function NotificationPrefsTab({ tenantId }: { tenantId: string }) {
  const enabled = useWorkspaceFeature("notification_prefs_matrix");
  const listFn = useServerFn(listNotificationPrefs);
  const setFn = useServerFn(setNotificationPref);
  const qc = useQueryClient();
  const { data: prefs } = useQuery({
    queryKey: ["wnp", tenantId], enabled, queryFn: () => listFn({ data: { tenantId } }),
  });
  if (!enabled) return <DisabledCard label="Notification preference matrix" />;
  const isOn = (event: string, ch: string) => {
    const p = (prefs ?? []).find((x: any) => x.event_type === event && x.channel === ch);
    return p ? p.enabled : true;
  };
  return (
    <Card className="mt-4">
      <CardHeader><CardTitle className="text-base">Notification channels × events</CardTitle></CardHeader>
      <CardContent>
        <table className="w-full text-sm">
          <thead><tr><th className="text-left py-2">Event</th>{CHANNELS.map((c) => <th key={c} className="py-2">{c}</th>)}</tr></thead>
          <tbody>
            {EVENT_TYPES.map((ev) => (
              <tr key={ev} className="border-t border-border">
                <td className="py-2">{ev}</td>
                {CHANNELS.map((ch) => (
                  <td key={ch} className="py-2 text-center">
                    <Switch checked={isOn(ev, ch)} onCheckedChange={async (v) => {
                      await setFn({ data: { tenantId, eventType: ev, channel: ch, enabled: v, digest: "immediate" } });
                      qc.invalidateQueries({ queryKey: ["wnp", tenantId] });
                    }} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════ Extended profile (W-10) ═════════════════════════
function ProfileTab() {
  const upFn = useServerFn(updateExtendedProfile);
  const enabled = useWorkspaceFeature("extended_profile_fields");
  const [state, setState] = useState({ jobTitle: "", employeeId: "", biography: "" });
  if (!enabled) return <DisabledCard label="Extended profile fields" />;
  return (
    <Card className="mt-4">
      <CardHeader><CardTitle className="text-base">Extended profile</CardTitle></CardHeader>
      <CardContent className="grid grid-cols-2 gap-3">
        <div><Label>Job title</Label><Input value={state.jobTitle} onChange={(e) => setState({ ...state, jobTitle: e.target.value })} /></div>
        <div><Label>Employee ID</Label><Input value={state.employeeId} onChange={(e) => setState({ ...state, employeeId: e.target.value })} /></div>
        <div className="col-span-2"><Label>Biography</Label><Textarea value={state.biography} onChange={(e) => setState({ ...state, biography: e.target.value })} /></div>
        <div className="col-span-2">
          <Button onClick={async () => { await upFn({ data: state }); toast.success("Profile updated"); }}>Save</Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════ Sidebar shortcuts (W-5) ═════════════════════════
function ShortcutsTab({ tenantId }: { tenantId: string }) {
  const enabled = useWorkspaceFeature("sidebar_shortcuts");
  const listFn = useServerFn(listShortcuts);
  const upFn = useServerFn(upsertShortcut);
  const delFn = useServerFn(deleteShortcut);
  const qc = useQueryClient();
  const [f, setF] = useState({ label: "", url: "", icon: "" });
  const { data: rows } = useQuery({
    queryKey: ["wss", tenantId], enabled, queryFn: () => listFn({ data: { tenantId } }),
  });
  if (!enabled) return <DisabledCard label="Sidebar shortcuts" />;
  return (
    <div className="mt-4 space-y-3">
      <Card>
        <CardHeader><CardTitle className="text-base">Add shortcut</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-4 gap-2">
          <Input placeholder="Label" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} />
          <Input className="col-span-2" placeholder="/path or https://…" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} />
          <Button onClick={async () => {
            if (!f.label || !f.url) return;
            await upFn({ data: { tenantId, label: f.label, url: f.url, icon: f.icon || null, orderIndex: (rows?.length ?? 0) } });
            setF({ label: "", url: "", icon: "" });
            qc.invalidateQueries({ queryKey: ["wss", tenantId] });
          }}>Add</Button>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-3 space-y-1">
          {(rows ?? []).length === 0 && <p className="text-sm text-muted-foreground">No shortcuts yet.</p>}
          {(rows ?? []).map((r: any) => (
            <div key={r.id} className="flex justify-between items-center border-b border-border py-1">
              <div><div className="font-semibold">{r.label}</div><div className="text-xs text-muted-foreground">{r.url}</div></div>
              <Button size="sm" variant="ghost" onClick={async () => { await delFn({ data: { id: r.id } }); qc.invalidateQueries({ queryKey: ["wss", tenantId] }); }}>Remove</Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

// ═══════════════════════════ Themes (W-7, W-8) ═══════════════════════════════
function ThemesTab() {
  const catalogEnabled = useWorkspaceFeature("theme_catalog_expanded");
  const wcag = useWorkspaceFeature("theme_wcag_scoring");
  const listFn = useServerFn(listThemesCatalog);
  const { data: themes, isLoading } = useQuery({
    queryKey: ["wtc"], enabled: catalogEnabled, queryFn: () => listFn(),
  });
  if (!catalogEnabled) return <DisabledCard label="Expanded theme catalog" />;
  return (
    <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
      {isLoading && Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
      {(themes ?? []).map((t: any) => (
        <Card key={t.key}>
          <CardHeader className="p-3">
            <CardTitle className="text-base flex items-center justify-between">
              <span>{t.name}</span>
              {wcag && t.wcag_grade && (
                <Badge variant={t.wcag_grade === "AAA" ? "default" : "secondary"}>
                  {t.wcag_grade} · {Number(t.wcag_score).toFixed(1)}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <div className="flex gap-1 h-6 rounded overflow-hidden">
              <div className="flex-1" style={{ background: t.palette.bg }} />
              <div className="flex-1" style={{ background: t.palette.fg }} />
              <div className="flex-1" style={{ background: t.palette.accent }} />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ═══════════════════════════ Drafts demo (W-18) ══════════════════════════════
function DraftsDemoTab({ tenantId }: { tenantId: string }) {
  const enabled = useWorkspaceFeature("autosave_drafts");
  const getFn = useServerFn(getDraft);
  const saveFn = useServerFn(saveDraft);
  const discardFn = useServerFn(discardDraft);
  const [text, setText] = useState("");
  const resource = { resourceType: "workspace.demo", resourceId: "draft-scratchpad" };
  useEffect(() => {
    if (!enabled) return;
    getFn({ data: { tenantId, ...resource } }).then((d: any) => { if (d?.payload?.text) setText(d.payload.text); }).catch(() => {});
  }, [enabled, tenantId]);
  useEffect(() => {
    if (!enabled) return;
    const t = setTimeout(() => {
      saveFn({ data: { tenantId, ...resource, payload: { text } } }).catch(() => {});
    }, 800);
    return () => clearTimeout(t);
  }, [text, enabled, tenantId]);
  if (!enabled) return <DisabledCard label="Autosave & draft recovery" />;
  return (
    <Card className="mt-4">
      <CardHeader><CardTitle className="text-base">Scratchpad · autosaves every 800ms</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} />
        <div className="flex gap-2">
          <Badge variant="outline">draft persisted</Badge>
          <Button size="sm" variant="ghost" onClick={async () => {
            await discardFn({ data: { tenantId, ...resource } }); setText(""); toast.success("Draft discarded");
          }}>Discard draft</Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════ Sessions (W-21, W-22) ═══════════════════════════
function SessionsTab({ tenantId }: { tenantId: string }) {
  const logoutAllEnabled = useWorkspaceFeature("logout_all_devices");
  const logoutFn = useServerFn(logoutAllDevices);
  return (
    <Card className="mt-4">
      <CardHeader><CardTitle className="text-base">Session management</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="text-sm">
          <div>Single-session enforcement: <Badge variant="secondary">Project-level Supabase Auth policy</Badge></div>
          <div>Log out from all devices: <Badge variant={logoutAllEnabled ? "default" : "secondary"}>{logoutAllEnabled ? "enabled" : "disabled"}</Badge></div>
        </div>
        {logoutAllEnabled ? (
          <Button variant="destructive" onClick={async () => {
            try {
              const result = await logoutFn({ data: { tenantId } });
              if (result.registry_updated) toast.success("Other devices signed out");
              else toast.warning("Other devices signed out; workspace session log could not be updated");
            } catch {
              toast.error("Could not sign out other devices");
            }
          }}>
            Log out other devices
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">Enable in Tenant Administration → Workspace features.</p>
        )}
      </CardContent>
    </Card>
  );
}
