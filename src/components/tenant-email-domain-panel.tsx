import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Globe2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { listTenantEmailDomains, verifyTenantEmailDomain } from "@/lib/signup-admission.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type EmailDomain = {
  id: string;
  domain: string;
  status: "pending" | "verified" | "suspended";
  txt_name: string;
  txt_value: string;
  verified_at: string | null;
};

export function TenantEmailDomainPanel({ tenantId }: { tenantId: string }) {
  const queryClient = useQueryClient();
  const list = useServerFn(listTenantEmailDomains);
  const verify = useServerFn(verifyTenantEmailDomain);
  const queryKey = ["tenant-email-domains", tenantId];
  const domains = useQuery({ queryKey, queryFn: () => list({ data: { tenant_id: tenantId } }) });
  const check = useMutation({
    mutationFn: (domainId: string) => verify({ data: { tenant_id: tenantId, domain_id: domainId } }),
    onSuccess: (result) => {
      toast[result.verified ? "success" : "info"](
        result.verified ? "Email domain verified" : "DNS proof has not been found yet",
      );
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: () => toast.error("Could not check the domain right now. Please try again."),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Globe2 className="h-4 w-4" aria-hidden /> Signup email domain</CardTitle>
        <CardDescription>Only verified email addresses at a verified domain can enter this tenant’s admission queue.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {domains.isPending ? <p role="status" className="text-sm text-muted-foreground">Loading domain status…</p> : null}
        {domains.isError ? (
          <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
            <p className="font-medium">Domain status unavailable</p>
            <p className="mt-1 text-muted-foreground">Signup routing cannot be confirmed. Try again shortly.</p>
            <Button className="mt-3" size="sm" variant="outline" onClick={() => void domains.refetch()}>Try again</Button>
          </div>
        ) : null}
        {domains.isSuccess && domains.data.length === 0 ? (
          <p role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">No signup email domain is registered for this tenant. Contact platform support before enabling self signup.</p>
        ) : null}
        {((domains.data ?? []) as EmailDomain[]).map((domain) => (
          <div key={domain.id} className="rounded-lg border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium">{domain.domain}</p>
                <p className="text-xs text-muted-foreground">Exact email domain match</p>
              </div>
              <Badge variant={domain.status === "verified" ? "default" : "outline"} className="gap-1.5">
                {domain.status === "verified" ? <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> : null}
                {domain.status === "verified" ? "Verified" : domain.status === "suspended" ? "Suspended" : "Pending DNS proof"}
              </Badge>
            </div>
            {domain.status === "pending" ? (
              <div className="mt-4 space-y-3 border-t pt-4 text-sm">
                <p className="text-muted-foreground">Ask your DNS administrator to add this TXT record, then check ownership. Requests remain closed until verification succeeds.</p>
                <dl className="grid gap-2 sm:grid-cols-[80px_minmax(0,1fr)]">
                  <dt className="text-muted-foreground">Name</dt><dd className="break-all rounded bg-muted px-2 py-1 font-mono text-xs">{domain.txt_name}</dd>
                  <dt className="text-muted-foreground">Value</dt><dd className="break-all rounded bg-muted px-2 py-1 font-mono text-xs">{domain.txt_value}</dd>
                </dl>
                <Button size="sm" disabled={check.isPending} onClick={() => check.mutate(domain.id)}>{check.isPending ? "Checking…" : "Check DNS verification"}</Button>
              </div>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
