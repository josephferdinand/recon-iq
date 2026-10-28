import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ShieldCheck, AlertTriangle, FileDown } from "lucide-react";
import {
  validateDoraRegister,
  validateEmirMapping,
  EMIR_DEFAULT_MAPPING,
  type DoraRegisterRow,
  type EmirFieldMapping,
} from "@/lib/dora-validate";

export function DoraValidationPanel({ register }: { register: DoraRegisterRow[] }) {
  const result = useMemo(() => validateDoraRegister(register ?? []), [register]);
  const [mapping, setMapping] = useState<EmirFieldMapping[]>(EMIR_DEFAULT_MAPPING);
  const emir = useMemo(() => validateEmirMapping(mapping), [mapping]);

  function downloadMapping() {
    const blob = new Blob([JSON.stringify(mapping, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `reconiq-emir-mapping-${new Date().toISOString().slice(0, 10)}.json`;
    a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4" /> DORA register readiness
          </CardTitle>
          <CardDescription>
            Demo Bank audit-ready check across required Article 28 fields.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Progress value={result.readiness} className="h-2" />
            <span className="text-sm font-medium w-12 text-right">{result.readiness}%</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant={result.audit_ready ? "default" : "outline"} className={result.audit_ready ? "bg-emerald-600" : ""}>
              {result.audit_ready ? "Audit-ready" : "Not ready"}
            </Badge>
            <Badge variant="outline">{result.total} providers</Badge>
            <Badge variant="destructive">{result.errors} errors</Badge>
            <Badge variant="secondary">{result.warnings} warnings</Badge>
          </div>
          <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border p-2">
            {result.issues.length === 0 && (
              <p className="text-xs text-muted-foreground">No issues. e.g. add Citibank N.A. for Demo Bank Nostro USD coverage.</p>
            )}
            {result.issues.map((i, idx) => (
              <div key={idx} className="flex items-start gap-2 text-xs">
                <AlertTriangle className={`mt-0.5 h-3 w-3 ${i.level === "error" ? "text-destructive" : "text-amber-500"}`} />
                <span><b className="font-medium">{i.field}</b> — {i.message}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle className="text-base">EMIR Refit mapping</CardTitle>
            <CardDescription>
              Map Demo Bank trade fields to the ESMA reporting dictionary.
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={downloadMapping}>
            <FileDown className="mr-1 h-3.5 w-3.5" /> Export
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center gap-2">
            <Progress value={emir.readiness} className="h-2" />
            <span className="text-sm font-medium w-12 text-right">{emir.readiness}%</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant={emir.audit_ready ? "default" : "outline"} className={emir.audit_ready ? "bg-emerald-600" : ""}>
              {emir.audit_ready ? "Audit-ready" : "Gaps remain"}
            </Badge>
            <Badge variant="destructive">{emir.errors} errors</Badge>
            <Badge variant="secondary">{emir.warnings} warnings</Badge>
          </div>
          <div className="max-h-72 space-y-1 overflow-y-auto rounded-md border">
            <table className="w-full text-xs">
              <thead className="border-b bg-muted/40 text-left text-[10px] uppercase text-muted-foreground">
                <tr><th className="px-2 py-1">ESMA field</th><th className="px-2 py-1">Source path</th><th className="px-2 py-1">Req</th></tr>
              </thead>
              <tbody>
                {mapping.map((m, i) => (
                  <tr key={i} className="border-b">
                    <td className="px-2 py-1">{m.esma_field}</td>
                    <td className="px-2 py-1">
                      <Input
                        className="h-7 text-xs"
                        value={m.source_path}
                        onChange={(e) => {
                          const next = mapping.slice();
                          next[i] = { ...m, source_path: e.target.value };
                          setMapping(next);
                        }}
                        placeholder={`e.g. ${m.example}`}
                      />
                    </td>
                    <td className="px-2 py-1">
                      <Switch checked={m.required} onCheckedChange={(v) => {
                        const next = mapping.slice();
                        next[i] = { ...m, required: v };
                        setMapping(next);
                      }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
