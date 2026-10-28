import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { diagnoseUserAccess } from "@/lib/platform-consoles.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Search, ShieldCheck } from "lucide-react";

export function PlatformRbacDiagnosticsTab() {
  const fn = useServerFn(diagnoseUserAccess);
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<any>(null);

  const m = useMutation({
    mutationFn: (v: { email: string }) => fn({ data: v }),
    onSuccess: (d) => setResult(d),
    onError: (e: any) => { setResult(null); toast.error(e.message); },
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Search className="h-4 w-4" /> RBAC diagnostics</CardTitle>
          <CardDescription>
            Explain why a user can — or cannot — perform an action. Enter their email to see platform roles,
            tenant memberships, RBAC grants, and their union of effective permissions.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Input
            value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="user@bank.com" className="max-w-md"
            onKeyDown={(e) => { if (e.key === "Enter" && email) m.mutate({ email }); }}
          />
          <Button onClick={() => m.mutate({ email })} disabled={!email || m.isPending}>
            Diagnose
          </Button>
        </CardContent>
      </Card>

      {result ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{result.subject.full_name ?? result.subject.email}</CardTitle>
              <CardDescription>
                {result.subject.email} · Platform roles:{" "}
                {result.platform_roles.length === 0 ? (
                  <Badge variant="outline">none</Badge>
                ) : result.platform_roles.map((r: string) => (
                  <Badge key={r} className="mr-1">{r}</Badge>
                ))}
              </CardDescription>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Tenant memberships ({result.tenant_memberships.length})</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2">Tenant</th>
                    <th className="px-4 py-2">Env</th>
                    <th className="px-4 py-2">Role</th>
                  </tr>
                </thead>
                <tbody>
                  {result.tenant_memberships.map((m: any) => (
                    <tr key={m.tenant_id} className="border-b">
                      <td className="px-4 py-2 text-xs">
                        <div className="font-medium">{m.tenant?.name ?? m.tenant_id}</div>
                        <div className="text-muted-foreground">/{m.tenant?.slug}</div>
                      </td>
                      <td className="px-4 py-2 text-xs uppercase">{m.tenant?.environment ?? "—"}</td>
                      <td className="px-4 py-2"><Badge variant="outline">{m.role}</Badge></td>
                    </tr>
                  ))}
                  {result.tenant_memberships.length === 0 ? (
                    <tr><td colSpan={3} className="px-4 py-6 text-center text-muted-foreground">No tenant memberships.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" /> Effective permissions ({result.effective_permissions.length})
              </CardTitle>
              <CardDescription>Union of permissions across all granted roles.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2">Permission</th>
                    <th className="px-4 py-2">Category</th>
                    <th className="px-4 py-2">Via roles</th>
                    <th className="px-4 py-2">Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {result.effective_permissions.map((p: any, i: number) => (
                    <tr key={p.permission?.id ?? i} className="border-b">
                      <td className="px-4 py-2 font-mono text-xs">
                        {p.permission?.resource}.{p.permission?.action}
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">{p.permission?.category ?? "—"}</td>
                      <td className="px-4 py-2 text-xs">
                        {p.via_roles.map((r: string) => <Badge key={r} variant="outline" className="mr-1">{r}</Badge>)}
                      </td>
                      <td className="px-4 py-2 text-xs">
                        {p.permission?.is_dangerous ? <Badge variant="destructive" className="mr-1">dangerous</Badge> : null}
                        {p.permission?.requires_step_up ? <Badge variant="secondary">step-up</Badge> : null}
                      </td>
                    </tr>
                  ))}
                  {result.effective_permissions.length === 0 ? (
                    <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                      No RBAC-granted permissions. User may still have platform-level access via platform_roles.
                    </td></tr>
                  ) : null}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
