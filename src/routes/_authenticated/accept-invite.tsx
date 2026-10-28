import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { z } from "zod";
import { acceptInvitation, listMyInvitations } from "@/lib/members.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Mail, Loader2, Sparkles, ArrowRight, BookOpen, Users, Settings, Home as HomeIcon } from "lucide-react";
import { toast } from "sonner";

const searchSchema = z.object({ token: z.string().optional() });

export const Route = createFileRoute("/_authenticated/accept-invite")({
  validateSearch: searchSchema,
  component: AcceptInvitePage,
});

type AcceptResult = { tenant_id: string; tenant_slug?: string; tenant_name?: string };

function AcceptInvitePage() {
  const { token: initialToken } = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const accept = useServerFn(acceptInvitation);
  const listMine = useServerFn(listMyInvitations);

  const [token, setToken] = useState(initialToken ?? "");
  const [joined, setJoined] = useState<AcceptResult | null>(null);

  const invitesQ = useQuery({
    queryKey: ["my-invitations"],
    queryFn: () => listMine(),
  });

  const mAccept = useMutation({
    mutationFn: (t: string) => accept({ data: { token: t } }),
    onSuccess: async (res: any) => {
      toast.success("Invitation accepted — welcome!");
      await qc.invalidateQueries({ queryKey: ["my-tenants"] });
      await qc.invalidateQueries({ queryKey: ["my-invitations"] });
      const tenants: any[] = (qc.getQueryData(["my-tenants"]) as any[]) ?? [];
      const t = tenants.find((x) => x.id === res.tenant_id);
      setJoined({ tenant_id: res.tenant_id, tenant_slug: t?.slug, tenant_name: t?.name });
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not accept invitation"),
  });

  useEffect(() => {
    if (initialToken && !mAccept.isPending && !mAccept.isSuccess) {
      mAccept.mutate(initialToken);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialToken]);

  if (joined) return <OnboardingChecklist joined={joined} />;

  const pending = invitesQ.data ?? [];

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div className="space-y-1">
        <h1 className="font-display text-2xl font-semibold">Accept a workspace invitation</h1>
        <p className="text-sm text-muted-foreground">
          Join a tenant workspace using an invite link, a token from your admin, or a pending
          invitation already addressed to your email.
        </p>
      </div>

      {pending.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Mail className="h-4 w-4" /> Pending invitations for you
            </CardTitle>
            <CardDescription>These invitations were sent to your email address.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {pending.map((i: any) => (
              <div
                key={i.id}
                className="flex items-center justify-between rounded-md border bg-card px-3 py-2"
              >
                <div>
                  <div className="font-medium">{i.tenant?.name ?? i.tenant_id}</div>
                  <div className="text-xs text-muted-foreground">
                    Role: <Badge variant="outline" className="ml-1">{i.role}</Badge>
                    <span className="ml-3">Expires {new Date(i.expires_at).toLocaleDateString()}</span>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">
                  Ask your admin for the accept link or token if you don't have one yet.
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Enter your invitation token</CardTitle>
          <CardDescription>
            Paste the token or full accept link your administrator shared.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="token">Invitation token or link</Label>
            <Input
              id="token"
              value={token}
              onChange={(e) => {
                const v = e.target.value;
                try {
                  const url = new URL(v);
                  const t = url.searchParams.get("token");
                  setToken(t ?? v);
                } catch {
                  setToken(v);
                }
              }}
              placeholder="e.g. 0f3a…"
              className="font-mono text-xs"
            />
          </div>
          <div className="flex items-center gap-3">
            <Button
              onClick={() => token && mAccept.mutate(token.trim())}
              disabled={!token.trim() || mAccept.isPending}
            >
              {mAccept.isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Accepting…</>
              ) : mAccept.isSuccess ? (
                <><CheckCircle2 className="mr-2 h-4 w-4" /> Accepted</>
              ) : (
                "Accept invitation"
              )}
            </Button>
            <Button variant="ghost" onClick={() => navigate({ to: "/home" })}>
              Back to Home
            </Button>
          </div>
          {mAccept.error ? (
            <p className="text-sm text-destructive">{(mAccept.error as any)?.message}</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

/** Guided onboarding shown right after a successful invitation acceptance. */
function OnboardingChecklist({ joined }: { joined: AcceptResult }) {
  const navigate = useNavigate();
  const slug = joined.tenant_slug;
  const name = joined.tenant_name ?? "your new workspace";

  const steps = [
    {
      icon: HomeIcon,
      title: "Open your workspace",
      desc: "Land on the tenant dashboard — recent runs, breaks, and alerts.",
      to: slug ? { to: "/$slug/workspace", params: { slug } } : { to: "/home" as const },
      cta: "Go to workspace",
    },
    {
      icon: Settings,
      title: "Complete tenant onboarding",
      desc: "Set your data sources, business calendar, and notification channels.",
      to: slug ? { to: "/$slug/onboarding", params: { slug } } : { to: "/home" as const },
      cta: "Start onboarding",
    },
    {
      icon: Users,
      title: "Meet your teammates",
      desc: "See who else has access and what roles they hold.",
      to: slug ? { to: "/$slug/tenant", params: { slug }, search: { page: "members" } } : { to: "/home" as const },
      cta: "View members",
    },
    {
      icon: BookOpen,
      title: "Read the quick-start guide",
      desc: "5-minute tour: reconciliations, breaks, evidence packs, Copilot.",
      to: slug ? { to: "/$slug/workspace/training", params: { slug } } : { to: "/home" as const },
      cta: "Open training",
    },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <Card className="border-primary/40 bg-primary/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            You're in — welcome to {name}
          </CardTitle>
          <CardDescription>
            Follow these steps to get productive in a few minutes. You can always come back to
            this list from your workspace.
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="grid gap-3">
        {steps.map((s, i) => (
          <Card key={i} className="transition hover:border-primary/40">
            <CardContent className="flex items-center justify-between gap-4 py-4">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <s.icon className="h-4 w-4" />
                </div>
                <div>
                  <div className="font-medium">
                    <span className="mr-2 text-xs text-muted-foreground">{i + 1}.</span>
                    {s.title}
                  </div>
                  <p className="text-sm text-muted-foreground">{s.desc}</p>
                </div>
              </div>
              <Link {...(s.to as any)}>
                <Button size="sm" variant="secondary">
                  {s.cta} <ArrowRight className="ml-1 h-3.5 w-3.5" />
                </Button>
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex justify-between pt-2">
        <Button variant="ghost" onClick={() => navigate({ to: "/home" })}>
          Skip for now
        </Button>
        {slug ? (
          <Button onClick={() => navigate({ to: "/$slug/workspace", params: { slug } })}>
            Enter workspace <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        ) : (
          <Button onClick={() => navigate({ to: "/home" })}>
            Back to Home <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

