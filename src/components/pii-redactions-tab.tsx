import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listPiiRedactionEvents,
  listKnownPiiPolicyVersions,
} from "@/lib/platform.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ShieldAlert, Filter, RefreshCw } from "lucide-react";

type Filters = {
  policy_version: string;
  tenant_id: string;
  user_id: string;
  destination: "" | "copilot" | "agent" | "embed" | "email";
  include_attributed: boolean;
  include_unattributed: boolean;
  limit: number;
};

const EMPTY: Filters = {
  policy_version: "",
  tenant_id: "",
  user_id: "",
  destination: "",
  include_attributed: true,
  include_unattributed: true,
  limit: 200,
};

export function PiiRedactionsTab() {
  const fetchEvents = useServerFn(listPiiRedactionEvents);
  const fetchVersions = useServerFn(listKnownPiiPolicyVersions);
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [applied, setApplied] = useState<Filters>(EMPTY);

  const versionsQ = useQuery({
    queryKey: ["pii-policy-versions"],
    queryFn: () => fetchVersions(),
  });

  const eventsQ = useQuery({
    queryKey: ["pii-redaction-events", applied],
    queryFn: () =>
      fetchEvents({
        data: {
          policy_version: applied.policy_version || undefined,
          tenant_id: applied.tenant_id || undefined,
          user_id: applied.user_id || undefined,
          destination: applied.destination || undefined,
          include_attributed: applied.include_attributed,
          include_unattributed: applied.include_unattributed,
          limit: applied.limit,
        },
      }),
  });

  const rows = eventsQ.data ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-lg font-semibold flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-amber-600" /> PII redaction events
        </h2>
        <p className="text-sm text-muted-foreground">
          Combined view over <code className="text-xs">ai_usage_events</code> (attributed) and{" "}
          <code className="text-xs">security_events</code> (<code className="text-xs">pii.redaction.unattributed</code>).
          Current policy version:{" "}
          <Badge variant="outline" className="font-mono text-xs">
            {versionsQ.data?.current ?? "—"}
          </Badge>
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Filter className="h-4 w-4" /> Filters
          </CardTitle>
          <CardDescription>Filter and search across both event sources.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-4">
            <div>
              <Label className="text-xs">Policy version</Label>
              <Input
                value={draft.policy_version}
                onChange={(e) => setDraft({ ...draft, policy_version: e.target.value })}
                placeholder={versionsQ.data?.current ?? "pii-policy@1"}
              />
            </div>
            <div>
              <Label className="text-xs">Tenant ID</Label>
              <Input
                value={draft.tenant_id}
                onChange={(e) => setDraft({ ...draft, tenant_id: e.target.value })}
                placeholder="uuid (blank = any)"
              />
            </div>
            <div>
              <Label className="text-xs">User (caller) ID</Label>
              <Input
                value={draft.user_id}
                onChange={(e) => setDraft({ ...draft, user_id: e.target.value })}
                placeholder="uuid (blank = any)"
              />
            </div>
            <div>
              <Label className="text-xs">Destination</Label>
              <Select
                value={draft.destination || "any"}
                onValueChange={(v) =>
                  setDraft({ ...draft, destination: v === "any" ? "" : (v as Filters["destination"]) })
                }
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any</SelectItem>
                  <SelectItem value="copilot">copilot</SelectItem>
                  <SelectItem value="agent">agent</SelectItem>
                  <SelectItem value="embed">embed</SelectItem>
                  <SelectItem value="email">email</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between rounded-md border p-2">
              <Label className="text-xs">Attributed</Label>
              <Switch
                checked={draft.include_attributed}
                onCheckedChange={(v) => setDraft({ ...draft, include_attributed: v })}
              />
            </div>
            <div className="flex items-center justify-between rounded-md border p-2">
              <Label className="text-xs">Unattributed</Label>
              <Switch
                checked={draft.include_unattributed}
                onCheckedChange={(v) => setDraft({ ...draft, include_unattributed: v })}
              />
            </div>
            <div>
              <Label className="text-xs">Limit</Label>
              <Input
                type="number"
                min={1}
                max={500}
                value={draft.limit}
                onChange={(e) => setDraft({ ...draft, limit: Math.max(1, Math.min(500, Number(e.target.value) || 200)) })}
              />
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <Button onClick={() => setApplied(draft)}>Apply filters</Button>
            <Button variant="outline" onClick={() => { setDraft(EMPTY); setApplied(EMPTY); }}>
              Reset
            </Button>
            <Button variant="ghost" onClick={() => eventsQ.refetch()}>
              <RefreshCw className="mr-1 h-4 w-4" /> Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {eventsQ.isLoading ? "Loading…" : `${rows.length} event${rows.length === 1 ? "" : "s"}`}
          </CardTitle>
          <CardDescription>Sorted most recent first.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Event</th>
                  <th className="px-3 py-2">Policy</th>
                  <th className="px-3 py-2">Tenant</th>
                  <th className="px-3 py-2">User</th>
                  <th className="px-3 py-2">Dest</th>
                  <th className="px-3 py-2">Counts</th>
                  <th className="px-3 py-2">Input hash</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r: any) => (
                  <tr key={`${r.source}:${r.id}`} className="border-b align-top">
                    <td className="px-3 py-2 text-xs text-muted-foreground">{new Date(r.occurred_at).toISOString()}</td>
                    <td className="px-3 py-2">
                      <Badge variant={r.source === "security_events" ? "destructive" : "outline"} className="font-mono text-[10px]">
                        {r.source}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{r.event_type}</td>
                    <td className="px-3 py-2 font-mono text-xs">{r.policy_version ?? "—"}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {r.tenant_id ?? <span className="text-amber-600">null</span>}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{r.user_id ?? "—"}</td>
                    <td className="px-3 py-2 text-xs">{r.destination ?? "—"}</td>
                    <td className="px-3 py-2 text-xs">
                      {Object.keys(r.counts ?? {}).length === 0
                        ? <span className="text-muted-foreground">none</span>
                        : Object.entries(r.counts).map(([k, v]) => (
                            <Badge key={k} variant="secondary" className="mr-1 font-mono text-[10px]">{k}:{String(v)}</Badge>
                          ))}
                    </td>
                    <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">
                      {r.input_hash ? r.input_hash.slice(0, 12) + "…" : "—"}
                    </td>
                  </tr>
                ))}
                {!eventsQ.isLoading && rows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-10 text-center text-muted-foreground">
                      No events match these filters.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
