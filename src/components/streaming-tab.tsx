import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listStreamingTopics, upsertStreamingTopic } from "@/lib/platform-depth.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Plus, Radio } from "lucide-react";

export function StreamingTab({ tenantId, canWrite }: { tenantId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const fetchFn = useServerFn(listStreamingTopics);
  const saveFn = useServerFn(upsertStreamingTopic);
  const q = useQuery({
    queryKey: ["stream-topics", tenantId],
    queryFn: () => fetchFn({ data: { tenant_id: tenantId } }),
  });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({
    name: "", source: "kafka", bootstrap: "", topic_path: "", format: "json",
    partition_key: "", expected_tps: 100, status: "configured",
  });
  const m = useMutation({
    mutationFn: () => saveFn({ data: { tenant_id: tenantId, ...form } }),
    onSuccess: () => {
      toast.success("Streaming topic saved");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["stream-topics", tenantId] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Radio className="h-4 w-4" /> Streaming spine (Kafka / Kinesis / CDC)
          </CardTitle>
          <CardDescription>
            Register low-latency event sources for near-real-time recons. Supports Avro/Protobuf/CloudEvents/ISO 20022 XML and CDC from Postgres/MySQL.
          </CardDescription>
        </div>
        {canWrite && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="mr-1 h-3.5 w-3.5" /> New topic</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Register streaming topic</DialogTitle></DialogHeader>
              <div className="grid gap-3">
                <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-2">
                  <div><Label>Source</Label>
                    <Select value={form.source} onValueChange={(v) => setForm({ ...form, source: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="kafka">Apache Kafka</SelectItem>
                        <SelectItem value="kinesis">AWS Kinesis</SelectItem>
                        <SelectItem value="pubsub">GCP Pub/Sub</SelectItem>
                        <SelectItem value="eventbridge">EventBridge</SelectItem>
                        <SelectItem value="cdc-postgres">CDC — Postgres</SelectItem>
                        <SelectItem value="cdc-mysql">CDC — MySQL</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Format</Label>
                    <Select value={form.format} onValueChange={(v) => setForm({ ...form, format: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="json">JSON</SelectItem>
                        <SelectItem value="avro">Avro</SelectItem>
                        <SelectItem value="protobuf">Protobuf</SelectItem>
                        <SelectItem value="cloudevents">CloudEvents</SelectItem>
                        <SelectItem value="iso20022-xml">ISO 20022 XML</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div><Label>Bootstrap / endpoint</Label>
                  <Input value={form.bootstrap} onChange={(e) => setForm({ ...form, bootstrap: e.target.value })} placeholder="e.g. kafka-demo-bank-1.demo-bank.example:9093,kafka-demo-bank-2.demo-bank.example:9093" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div><Label>Topic / stream</Label><Input value={form.topic_path} onChange={(e) => setForm({ ...form, topic_path: e.target.value })} /></div>
                  <div><Label>Partition key</Label><Input value={form.partition_key} onChange={(e) => setForm({ ...form, partition_key: e.target.value })} /></div>
                </div>
                <div><Label>Expected TPS</Label>
                  <Input type="number" value={form.expected_tps}
                    onChange={(e) => setForm({ ...form, expected_tps: +e.target.value })} />
                </div>
                <Button disabled={!form.name || m.isPending} onClick={() => m.mutate()}>Save topic</Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Topic</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Format</TableHead>
              <TableHead>Path</TableHead>
              <TableHead className="text-right">TPS</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(q.data ?? []).map((t: any) => (
              <TableRow key={t.id}>
                <TableCell className="font-medium">{t.name}</TableCell>
                <TableCell><Badge variant="outline">{t.source}</Badge></TableCell>
                <TableCell className="text-xs">{t.format}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{t.topic_path ?? "—"}</TableCell>
                <TableCell className="text-right">{t.expected_tps ?? "—"}</TableCell>
                <TableCell><Badge variant={t.status === "active" ? "default" : "secondary"}>{t.status}</Badge></TableCell>
              </TableRow>
            ))}
            {q.data && q.data.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-6">No streaming topics yet.</TableCell></TableRow>
            ) : null}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
