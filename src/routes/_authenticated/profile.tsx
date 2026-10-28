/**
 * /profile — User-level profile (NOT tenant-scoped).
 *
 * Owns identity, contact, professional, notification, and security surfaces
 * for the logged-in user. Tenant-scoped settings live under $slug/tenant.settings.*
 *
 * All writes go through src/lib/profile.functions.ts which is RLS-gated via
 * requireSupabaseAuth(). Email change goes through supabase.auth.updateUser on
 * the client (it triggers a confirmation email — never accept it server-side).
 */
import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronUp,
  Globe,
  KeyRound,
  Loader2,
  Mail,
  Phone,
  Save,
  ShieldCheck,
  Smartphone,
  User as UserIcon,
} from "lucide-react";

import { BackButton } from "@/components/back-button";

import { supabase } from "@/integrations/supabase/client";
import { reportAuthEvent, mapAuthError } from "@/lib/auth-audit";
import { getMyProfile, updateMyProfile, type MyProfile } from "@/lib/profile.functions";
import { getUiPreferences, updateUiPreferences } from "@/lib/ui-prefs.functions";
import { supportedLocales } from "@/lib/i18n";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { NativeMfaPanel } from "@/components/native-mfa-panel";

export const Route = createFileRoute("/_authenticated/profile")({
  component: ProfileRoute,
});

function ProfileRoute() {
  const isIndex = useRouterState({ select: (state) => state.location.pathname === "/profile" });
  return isIndex ? <ProfilePage /> : <Outlet />;
}

const E164_RE = /^\+[1-9]\d{6,14}$/;

function normalizePhone(input: string): string | null {
  const trimmed = input.replace(/[\s().-]/g, "");
  if (!trimmed) return null;
  if (trimmed.startsWith("+")) return E164_RE.test(trimmed) ? trimmed : null;
  if (/^\d{10,15}$/.test(trimmed)) return `+${trimmed}`;
  return null;
}

function initialsFor(name: string | null | undefined, email: string | null | undefined): string {
  const src = (name || email || "?").split(/[\s@.]+/).filter(Boolean).slice(0, 2);
  return src.map((s) => s[0]?.toUpperCase()).join("") || "?";
}

function ProfilePage() {
  const qc = useQueryClient();
  const getProfile = useServerFn(getMyProfile);
  const doUpdate = useServerFn(updateMyProfile);
  const getPrefs = useServerFn(getUiPreferences);
  const doUpdatePrefs = useServerFn(updateUiPreferences);

  const profileQ = useQuery({
    queryKey: ["my-profile"],
    queryFn: () => getProfile(),
  });
  const prefsQ = useQuery({
    queryKey: ["my-ui-prefs"],
    queryFn: () => getPrefs(),
  });

  // Timezone list — Intl.supportedValuesOf is widely available in modern browsers
  // and Cloudflare Workers (Node 22+).
  const tzList = useMemo<string[]>(() => {
    try {
      const v = (Intl as any).supportedValuesOf?.("timeZone");
      return Array.isArray(v) && v.length > 0 ? (v as string[]) : ["UTC"];
    } catch {
      return ["UTC"];
    }
  }, []);

  if (profileQ.isLoading || prefsQ.isLoading) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading profile…
      </div>
    );
  }
  if (profileQ.error) {
    return (
      <Alert variant="destructive" className="m-6">
        <AlertTitle>Could not load profile</AlertTitle>
        <AlertDescription>{(profileQ.error as Error).message}</AlertDescription>
      </Alert>
    );
  }
  if (prefsQ.error) {
    return (
      <Alert variant="destructive" className="m-6">
        <AlertTitle>Could not load preferences</AlertTitle>
        <AlertDescription>{(prefsQ.error as Error).message}</AlertDescription>
      </Alert>
    );
  }

  const profile = profileQ.data!;
  const prefs = prefsQ.data!;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <BackButton fallbackTo="/home" label="Back" className="mb-2" />
      <header className="flex items-center gap-4">
        <Avatar className="h-16 w-16">
          {profile.avatar_url ? <AvatarImage src={profile.avatar_url} alt="" /> : null}
          <AvatarFallback className="bg-primary text-primary-foreground text-lg font-semibold">
            {initialsFor(profile.full_name, profile.email)}
          </AvatarFallback>
        </Avatar>
        <div>
          <h1 className="font-display text-2xl font-semibold">Your profile</h1>
          <p className="text-sm text-muted-foreground">
            Identity, contact, and notification preferences for{" "}
            <span className="font-medium text-foreground">{profile.email}</span>
          </p>
        </div>
      </header>

      <IdentitySection profile={profile} update={doUpdate} qc={qc} />
      <ContactSection profile={profile} tzList={tzList} update={doUpdate} qc={qc} />
      <ProfessionalSection profile={profile} update={doUpdate} qc={qc} />
      <NotificationSection
        emailDigest={(prefs as any).email_digest ?? "off"}
        marketingOptIn={profile.marketing_opt_in}
        updatePrefs={doUpdatePrefs}
        updateProfile={doUpdate}
        qc={qc}
      />
      <SecuritySection qc={qc} />
    </div>
  );
}

/* ── Identity ──────────────────────────────────────────────────────────── */
function IdentitySection({
  profile,
  update,
  qc,
}: {
  profile: MyProfile;
  update: ReturnType<typeof useServerFn<typeof updateMyProfile>>;
  qc: ReturnType<typeof useQueryClient>;
}) {
  const [fullName, setFullName] = useState(profile.full_name ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);

  useEffect(() => setFullName(profile.full_name ?? ""), [profile.full_name]);

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmed = fullName.trim();
    if (!trimmed) {
      setError("Name cannot be empty");
      return;
    }
    setSaving(true);
    try {
      await update({ data: { full_name: trimmed } });
      await qc.invalidateQueries({ queryKey: ["my-profile"] });
      qc.invalidateQueries({ queryKey: ["me-profile"] });
      reportAuthEvent("auth.success_login" as any, {
        user_id: profile.user_id,
        context: { event: "profile.updated", fields: ["full_name"] },
      });
      toast.success("Name saved");
    } catch (err: any) {
      setError(err?.message ?? "Could not save");
      setFullName(profile.full_name ?? "");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserIcon className="h-5 w-5" /> Identity
        </CardTitle>
        <CardDescription>How you appear across ReconIQ.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={onSave} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="full_name">Full name</Label>
            <Input
              id="full_name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              maxLength={120}
              autoComplete="name"
              className="h-10"
            />
          </div>
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Could not save</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <Button type="submit" disabled={saving || fullName.trim() === (profile.full_name ?? "")}>
            <Save className="mr-2 h-4 w-4" /> Save name
          </Button>
        </form>

        <div className="rounded-lg border bg-muted/30 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Mail className="h-4 w-4" /> {profile.email}
                {profile.email_confirmed_at ? (
                  <Badge variant="secondary" className="ml-1">Verified</Badge>
                ) : (
                  <Badge variant="outline" className="ml-1">Unverified</Badge>
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Changing your email triggers a confirmation link to the new address.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setEmailOpen(true)}>
              Change email
            </Button>
          </div>
        </div>

        <ChangeEmailDialog
          open={emailOpen}
          onOpenChange={setEmailOpen}
          currentEmail={profile.email}
          onSaved={async () => {
            await qc.invalidateQueries({ queryKey: ["my-profile"] });
          }}
        />
      </CardContent>
    </Card>
  );
}

function ChangeEmailDialog({
  open,
  onOpenChange,
  currentEmail,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  currentEmail: string;
  onSaved: () => Promise<void> | void;
}) {
  const [newEmail, setNewEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ title: string; hint?: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = z.string().email("Enter a valid email address").safeParse(newEmail);
    if (!parsed.success) {
      setError({ title: parsed.error.issues[0].message });
      return;
    }
    if (newEmail.toLowerCase() === currentEmail.toLowerCase()) {
      setError({ title: "This is already your current email" });
      return;
    }
    setBusy(true);
    const { error: err } = await supabase.auth.updateUser({ email: newEmail });
    setBusy(false);
    if (err) {
      const mapped = mapAuthError(err);
      setError({ title: mapped.title, hint: mapped.hint });
      return;
    }
    reportAuthEvent("auth.success_login" as any, {
      email: newEmail,
      context: { event: "profile.email_change_requested" },
    });
    toast.success("Confirmation email sent", {
      description: `Check ${newEmail} to confirm the change.`,
    });
    onOpenChange(false);
    setNewEmail("");
    await onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change email</DialogTitle>
          <DialogDescription>
            We'll send a confirmation link to your new address. Your current email stays active until you confirm.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="new-email">New email</Label>
            <Input
              id="new-email"
              type="email"
              autoComplete="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              required
            />
          </div>
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>{error.title}</AlertTitle>
              {error.hint ? <AlertDescription>{error.hint}</AlertDescription> : null}
            </Alert>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
              Send confirmation
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ── Contact ───────────────────────────────────────────────────────────── */
function ContactSection({
  profile,
  tzList,
  update,
  qc,
}: {
  profile: MyProfile;
  tzList: string[];
  update: ReturnType<typeof useServerFn<typeof updateMyProfile>>;
  qc: ReturnType<typeof useQueryClient>;
}) {
  const [phone, setPhone] = useState(profile.phone_e164 ?? "");
  const [timezone, setTimezone] = useState(profile.timezone);
  const [locale, setLocale] = useState(profile.locale);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPhone(profile.phone_e164 ?? "");
    setTimezone(profile.timezone);
    setLocale(profile.locale);
  }, [profile.phone_e164, profile.timezone, profile.locale]);

  const dirty =
    phone !== (profile.phone_e164 ?? "") ||
    timezone !== profile.timezone ||
    locale !== profile.locale;

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const normalisedPhone = phone ? normalizePhone(phone) : null;
    if (phone && !normalisedPhone) {
      setError("Phone must be in E.164 format, e.g. +14155552671");
      return;
    }
    if (timezone !== "UTC" && !tzList.includes(timezone)) {
      setError("Pick a valid timezone");
      return;
    }
    if (!supportedLocales.includes(locale as any)) {
      setError("Unsupported locale");
      return;
    }
    setBusy(true);
    const previous = { phone, timezone, locale };
    setPhone(normalisedPhone ?? "");
    try {
      await update({
        data: {
          phone_e164: normalisedPhone,
          timezone,
          locale,
        },
      });
      await qc.invalidateQueries({ queryKey: ["my-profile"] });
      toast.success("Contact details saved");
    } catch (err: any) {
      // revert
      setPhone(previous.phone);
      setTimezone(previous.timezone);
      setLocale(previous.locale);
      setError(err?.message ?? "Could not save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Phone className="h-5 w-5" /> Contact
        </CardTitle>
        <CardDescription>
          How we reach you. Used for notifications and MFA recovery.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSave} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="phone_e164">Phone (E.164)</Label>
            <Input
              id="phone_e164"
              type="tel"
              autoComplete="tel"
              placeholder="+14155552671"
              maxLength={16}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="h-10 font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Optional. Format: + and country code, e.g. +14155552671.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="tz">
                <Globe className="mr-1 inline h-3.5 w-3.5" /> Timezone
              </Label>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger id="tz" className="h-10">
                  <SelectValue placeholder="Select timezone" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {tzList.map((tz) => (
                    <SelectItem key={tz} value={tz}>
                      {tz}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="locale">Language</Label>
              <Select value={locale} onValueChange={setLocale}>
                <SelectTrigger id="locale" className="h-10">
                  <SelectValue placeholder="Select locale" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en-US">English (US)</SelectItem>
                  <SelectItem value="fr-FR">Français (FR)</SelectItem>
                  <SelectItem value="es-ES">Español (ES)</SelectItem>
                  <SelectItem value="de-DE">Deutsch (DE)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Could not save</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <Button type="submit" disabled={busy || !dirty}>
            <Save className="mr-2 h-4 w-4" /> Save contact
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/* ── Professional (collapsible, optional) ──────────────────────────────── */
function ProfessionalSection({
  profile,
  update,
  qc,
}: {
  profile: MyProfile;
  update: ReturnType<typeof useServerFn<typeof updateMyProfile>>;
  qc: ReturnType<typeof useQueryClient>;
}) {
  const [open, setOpen] = useState<boolean>(!!profile.job_title);
  const [jobTitle, setJobTitle] = useState(profile.job_title ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setJobTitle(profile.job_title ?? ""), [profile.job_title]);

  const dirty = jobTitle !== (profile.job_title ?? "");

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmed = jobTitle.trim();
    if (trimmed && trimmed.length > 120) {
      setError("Job title is too long (120 chars max)");
      return;
    }
    setBusy(true);
    const previous = jobTitle;
    setJobTitle(trimmed);
    try {
      await update({ data: { job_title: trimmed || null } });
      await qc.invalidateQueries({ queryKey: ["my-profile"] });
      toast.success("Job title saved");
    } catch (err: any) {
      setJobTitle(previous);
      setError(err?.message ?? "Could not save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5" /> Professional
            </CardTitle>
            <CardDescription>
              Optional role information. Visible only to people in the same workspace.
            </CardDescription>
          </div>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" aria-label={open ? "Collapse" : "Expand"}>
              {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              {open ? "Hide" : "Show"}
            </Button>
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent>
          <CardContent>
            <form onSubmit={save} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="job_title">Job title</Label>
                <Input
                  id="job_title"
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                  maxLength={120}
                  placeholder="Head of Reconciliation"
                  className="h-10"
                />
              </div>
              {error ? (
                <Alert variant="destructive">
                  <AlertTitle>Could not save</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
              <Button type="submit" disabled={busy || !dirty}>
                <Save className="mr-2 h-4 w-4" /> Save job title
              </Button>
            </form>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

/* ── Notification preferences ──────────────────────────────────────────── */
function NotificationSection({
  emailDigest,
  marketingOptIn,
  updatePrefs,
  updateProfile,
  qc,
}: {
  emailDigest: string;
  marketingOptIn: boolean;
  updatePrefs: ReturnType<typeof useServerFn<typeof updateUiPreferences>>;
  updateProfile: ReturnType<typeof useServerFn<typeof updateMyProfile>>;
  qc: ReturnType<typeof useQueryClient>;
}) {
  const [digest, setDigest] = useState(emailDigest);
  const [marketing, setMarketing] = useState(marketingOptIn);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDigest(emailDigest);
    setMarketing(marketingOptIn);
  }, [emailDigest, marketingOptIn]);

  const dirty = digest !== emailDigest || marketing !== marketingOptIn;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const updates: Array<Promise<unknown>> = [];
      if (digest !== emailDigest) {
        updates.push(
          updatePrefs({ data: { ...( { email_digest: digest } as any) } } as any),
        );
      }
      if (marketing !== marketingOptIn) {
        updates.push(updateProfile({ data: { marketing_opt_in: marketing } }));
      }
      await Promise.all(updates);
      await qc.invalidateQueries({ queryKey: ["my-ui-prefs"] });
      await qc.invalidateQueries({ queryKey: ["my-profile"] });
      toast.success("Notification preferences saved");
    } catch (err: any) {
      // revert
      setDigest(emailDigest);
      setMarketing(marketingOptIn);
      toast.error((err as Error)?.message ?? "Could not save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notification preferences</CardTitle>
        <CardDescription>
          Choose which emails we send you. Operational alerts are always on.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="digest">Email digest</Label>
            <Select value={digest} onValueChange={setDigest}>
              <SelectTrigger id="digest" className="h-10 w-full sm:w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="off">Off — no digest</SelectItem>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Summary of reconciliation activity in your workspaces.
            </p>
          </div>

          <div className="flex items-start justify-between gap-3 rounded-lg border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="marketing" className="text-sm font-medium">
                Product updates & offers
              </Label>
              <p className="text-xs text-muted-foreground">
                Occasional emails about new ReconIQ features. Never more than once a month.
              </p>
            </div>
            <Switch
              id="marketing"
              checked={marketing}
              onCheckedChange={setMarketing}
              aria-label="Marketing opt-in"
            />
          </div>

          <Button type="submit" disabled={busy || !dirty}>
            <Save className="mr-2 h-4 w-4" /> Save preferences
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/* ── Security ──────────────────────────────────────────────────────────── */
function SecuritySection({ qc }: { qc: ReturnType<typeof useQueryClient> }) {
  const [mfaOpen, setMfaOpen] = useState(false);

  // MFA status check. Two systems are in play:
  //  1. Supabase Auth's first-party MFA (auth.mfa.listFactors()) — available
  //     to the publishable key for the authenticated user.
  //  2. ReconIQ's custom platform_mfa_totp / platform_mfa_sms tables — server-fn
  //     gated; counts verified rows for the current user.
  // Only a verified Supabase Auth factor is login-enforced and may be called
  // enrolled. Legacy platform rows are reported separately for migration.
  const mfaQ = useQuery({
    queryKey: ["profile-mfa-status"],
    queryFn: async () => {
      const out = {
        enrolled: false as boolean,
        legacyOnly: false as boolean,
        authFactors: 0,
        platformFactors: 0,
      };
      try {
        const { data, error } = await supabase.auth.mfa.listFactors();
        if (!error && data) {
          const all = (data.all ?? []) as Array<{ status?: string }>;
          out.authFactors = all.filter((f) => f.status === "verified").length;
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[profile/mfa] auth.mfa.listFactors threw", e);
      }
      try {
        // Server-side RLS-gated counts. Both tables have user_id columns
        // scoped to the authenticated user.
        const [totp, sms] = await Promise.all([
          supabase
            .from("platform_mfa_totp" as any)
            .select("id")
            .eq("verified", true),
          supabase
            .from("platform_mfa_sms" as any)
            .select("id")
            .eq("verified", true),
        ]);
        out.platformFactors = ((totp.data ?? []) as any[]).length + ((sms.data ?? []) as any[]).length;
      } catch {
        // platform tables may not be readable from the client; ignore.
        out.platformFactors = 0;
      }
      out.enrolled = out.authFactors > 0;
      out.legacyOnly = out.authFactors === 0 && out.platformFactors > 0;
      return out;
    },
    staleTime: 30_000,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5" /> Security
        </CardTitle>
        <CardDescription>
          Password and authentication settings. Changes here apply to your account only.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
          <div className="flex items-start gap-3">
            <KeyRound className="mt-0.5 h-5 w-5 text-muted-foreground" />
            <div>
              <div className="text-sm font-medium">Password</div>
              <p className="text-xs text-muted-foreground">
                Change the password you use to sign in to ReconIQ.
              </p>
            </div>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link to="/profile/security">Change password</Link>
          </Button>
        </div>

        <div className="rounded-lg border p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <Smartphone className="mt-0.5 h-5 w-5 text-muted-foreground" />
              <div>
                <div className="flex items-center gap-2 text-sm font-medium">
                  Multi-factor authentication
                  {mfaQ.data?.enrolled ? (
                    <Badge variant="secondary">Enrolled</Badge>
                  ) : mfaQ.data?.legacyOnly ? (
                    <Badge variant="destructive">Legacy only — not login enforced</Badge>
                  ) : (
                    <Badge variant="outline">Not enrolled</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Enroll a Supabase Auth TOTP factor to require AAL2 after password sign-in.
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => setMfaOpen(true)}>
              {mfaQ.data?.enrolled ? "Manage" : "Enable login MFA"}
            </Button>
          </div>
        </div>

        <Dialog
          open={mfaOpen}
          onOpenChange={(v) => {
            setMfaOpen(v);
            // When the dialog closes, refresh MFA status so a newly enrolled
            // or disabled factor is reflected in the badge without a page reload.
            if (!v) qc.invalidateQueries({ queryKey: ["profile-mfa-status"] });
          }}
        >
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Multi-factor authentication</DialogTitle>
              <DialogDescription>
                Add a login-enforced authenticator app (TOTP) as your second factor.
              </DialogDescription>
            </DialogHeader>
            <NativeMfaPanel onChanged={() => qc.invalidateQueries({ queryKey: ["profile-mfa-status"] })} />
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
