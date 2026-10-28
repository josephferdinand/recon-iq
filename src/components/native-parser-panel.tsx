import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { formatUserMessage, mapKnownFailure, type UserMessage, type UserMessageCategory } from "@/lib/user-message";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { FileScan, UploadCloud, CheckCircle2, AlertCircle } from "lucide-react";
import { parseStatementFile, listParserRuns } from "@/lib/parsers.functions";

const DEMO_BANK_SAMPLE_MT940 = [
  ":20:DEMO-BANK-USD",
  ":25:GB29NWBK60161331926819",
  ":28C:00126/001",
  ":60F:C260627USD1250000,00",
  ":61:2606270627CR250000,50NTRFDEMO-BANK-E2E-77//BANKREF-A9",
  ":86:Demo Bank nostro top-up from JPM London",
  ":62F:C260627USD1500000,50",
].join("\n");

function parserFailure(error: unknown): UserMessage {
  const candidate = error && typeof error === "object" ? error as { code?: unknown; status?: unknown } : {};
  const code = typeof candidate.code === "string" ? candidate.code : undefined;
  const status = typeof candidate.status === "number" ? candidate.status : undefined;
  const mapped = mapKnownFailure(code, status);
  const knownRejection = ["input", "business", "auth", "session", "mfa"].includes(mapped.category);
  const category: UserMessageCategory = knownRejection ? mapped.category : "unknown_write_outcome";
  const fields = mapped.category === "input"
    ? [{ field: "Statement content", issue: "invalid_format" as const }]
    : undefined;
  return formatUserMessage({
    ...mapped,
    category,
    action: "parse this statement file",
    code,
    status,
    fields,
    availableActions: category === "unknown_write_outcome" || mapped.reason === "duplicate"
      ? [{ id: "check-history", label: "Refresh parse history" }]
      : [],
  });
}

export function NativeParserPanel({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const parseFn = useServerFn(parseStatementFile);
  const listFn = useServerFn(listParserRuns);

  const [filename, setFilename] = useState("");
  const [content, setContent] = useState("");
  const [message, setMessage] = useState<UserMessage | null>(null);

  const runs = useQuery({
    queryKey: ["parser-runs", tenantId],
    queryFn: () => listFn({ data: { tenant_id: tenantId, limit: 10 } }),
  });

  const m = useMutation({
    mutationFn: () => parseFn({
        data: {
          tenant_id: tenantId,
          filename: filename || undefined,
          content,
        },
      }),
    onSuccess: (r) => {
      toast.success(
        r.deduped
          ? `Already parsed — ${r.messages_out} messages (deduped via SHA-256)`
          : `Parsed ${r.messages_out} message${r.messages_out === 1 ? "" : "s"} as ${r.kind}`,
      );
      qc.invalidateQueries({ queryKey: ["parser-runs", tenantId] });
    },
    onError: (error) => {
      setMessage(parserFailure(error));
    },
  });

  function submitParse() {
    const fields = [];
    if (!content.trim()) fields.push({ field: "Statement content", issue: "required" as const });
    if (content.length > 10_000_000) fields.push({ field: "Statement content", issue: "too_long" as const, limit: 10_000_000 });
    if (filename.length > 512) fields.push({ field: "Filename", issue: "too_long" as const, limit: 512 });
    if (fields.length) {
      setMessage(formatUserMessage({ category: "input", action: "parse this statement file", fields }));
      return;
    }
    setMessage(null);
    m.mutate();
  }

  async function onFile(file: File) {
    const extension = `.${file.name.split(".").pop()?.toLowerCase() ?? ""}`;
    if (![".xml", ".mt", ".mt940", ".mt942", ".txt"].includes(extension)) {
      setMessage(formatUserMessage({
        category: "input",
        action: "parse this statement file",
        fields: [{ field: "File type", issue: "unsupported_value", allowedValues: [".xml", ".mt", ".mt940", ".mt942", ".txt"] }],
      }));
      return;
    }
    try {
      const text = await file.text();
      setFilename(file.name);
      setContent(text);
      setMessage(null);
    } catch {
      setMessage(formatUserMessage({ category: "system", action: "read this statement file" }));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <FileScan className="h-4 w-4" /> Native parsers — SWIFT MT &amp; ISO 20022
        </CardTitle>
        <CardDescription>
          Drop a Demo Bank MT940/MT942 message or a CAMT.053/054 XML file and ReconIQ extracts the
          canonical statement straight into the recon engine. Results are SHA-256 dedup&apos;d and
          recorded in <code className="rounded bg-muted px-1">parser_runs</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="parser-filename">Filename (optional)</Label>
            <Input
              id="parser-filename"
              placeholder="DEMO-BANK-USD-20260627.mt940"
              value={filename}
              aria-invalid={Boolean(message?.fieldErrors.Filename)}
              aria-describedby={message?.fieldErrors.Filename ? "parser-filename-error" : undefined}
              onChange={(e) => { setFilename(e.target.value); setMessage(null); }}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="parser-file">Upload file</Label>
            <Input
              id="parser-file"
              type="file"
              accept=".xml,.mt,.mt940,.mt942,.txt"
              aria-invalid={Boolean(message?.fieldErrors["File type"])}
              aria-describedby={message?.fieldErrors["File type"] ? "parser-file-error" : undefined}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
              }}
            />
          </div>
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <Label htmlFor="parser-content">Or paste raw content</Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setFilename("DEMO-BANK-USD-sample.mt940");
                setContent(DEMO_BANK_SAMPLE_MT940);
              }}
            >
              Load Demo Bank sample
            </Button>
          </div>
          <Textarea
            id="parser-content"
            rows={10}
            placeholder=":20:DEMO-BANK-USD..."
            value={content}
            aria-invalid={Boolean(message?.fieldErrors["Statement content"])}
            aria-describedby={message?.fieldErrors["Statement content"] ? "parser-content-error" : undefined}
            onChange={(e) => { setContent(e.target.value); setMessage(null); }}
            className="font-mono text-xs"
          />
        </div>

        <div className="flex justify-end">
          <Button
            onClick={submitParse}
            disabled={m.isPending}
          >
            <UploadCloud className="mr-2 h-4 w-4" />
            {m.isPending ? "Parsing…" : "Parse file"}
          </Button>
        </div>

        {message ? (
          <div role="alert" aria-live="assertive" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <p className="font-medium">{message.title}</p>
            <p className="mt-1">{message.humanMessage}</p>
            {message.fieldErrors.Filename ? <p id="parser-filename-error" className="mt-1 text-destructive">{message.fieldErrors.Filename}</p> : null}
            {message.fieldErrors["Statement content"] ? <p id="parser-content-error" className="mt-1 text-destructive">{message.fieldErrors["Statement content"]}</p> : null}
            {message.fieldErrors["File type"] ? <p id="parser-file-error" className="mt-1 text-destructive">{message.fieldErrors["File type"]}</p> : null}
            {message.nextActions.map((action) => action.id === "check-history" ? (
              <Button key={action.id} type="button" size="sm" variant="outline" className="mt-2" onClick={() => void runs.refetch()}>{action.label}</Button>
            ) : null)}
          </div>
        ) : null}

        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Recent runs
          </div>
          <div className="space-y-1">
            {runs.isError ? (
              <div role="alert" className="rounded-md border border-destructive/30 p-3 text-sm">
                <p>Parse history is temporarily unavailable, so the run list may be incomplete.</p>
                <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => void runs.refetch()}>Refresh parse history</Button>
              </div>
            ) : null}
            {!runs.isError && (runs.data ?? []).length === 0 && (
              <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
                No parser runs yet. Paste a Demo Bank MT940 or CAMT.053 XML above to see it land here.
              </div>
            )}
            {(runs.data ?? []).map((r: any) => (
              <div
                key={r.id}
                className="flex items-center justify-between rounded-md border bg-card px-3 py-2 text-xs"
              >
                <div className="flex items-center gap-2 min-w-0">
                  {r.status === "succeeded" ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                  ) : (
                    <AlertCircle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      {r.source_filename ?? "(inline paste)"}
                    </div>
                    <div className="truncate text-[10px] text-muted-foreground">
                      sha256 {String(r.source_sha256 ?? "").slice(0, 16)}… · {r.bytes_in} bytes
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{r.messages_out} msgs</Badge>
                  <Badge variant={r.status === "succeeded" ? "secondary" : "destructive"}>
                    {r.status}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
