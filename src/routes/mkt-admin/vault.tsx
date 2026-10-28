import { createFileRoute, redirect } from "@tanstack/react-router";
import { assertMktRolesFn } from "@/lib/mkt-admin.functions";
import { MKT_TAB_ROLES } from "@/lib/mkt-admin-roles";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/password-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { KeyRound, ShieldCheck, RotateCw, Trash2, Plus, Fingerprint, Lock } from "lucide-react";
import {
  listVaultSecrets,
  putVaultSecret,
  deleteVaultSecret,
  listVaultRotationLog,
} from "@/lib/vault.functions";

export const Route = createFileRoute("/mkt-admin/vault")({
  beforeLoad: async () => {
    try {
      await assertMktRolesFn({ data: { allowed: MKT_TAB_ROLES.vault } });
    } catch {
      throw redirect({ to: "/mkt-admin" });
    }
  },
  component: VaultPage,
});

const SECRET_CLASSES = [
  { key: "llm_api_key", label: "LLM API key" },
  { key: "integration_token", label: "Integration token" },
  { key: "webhook_secret", label: "Webhook secret" },
  { key: "signing_key", label: "Signing key" },
  { key: "kms_credential", label: "KMS credential" },
  { key: "generic", label: "Generic" },
] as const;
type SecretClass = (typeof SECRET_CLASSES)[number]["key"];

function VaultPage() {
  const listFn = useServerFn(listVaultSecrets);
  const q = useQuery({
    queryKey: ["vault", "platform"],
    queryFn: () => listFn({ data: { scope: "platform" as const } }),
  });
  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Platform · secure vault
          </div>
          <h1 className="mt-1 flex items-center gap-2 font-display text-2xl font-semibold">
            <ShieldCheck className="h-6 w-6 text-primary" /> Secure secret vault
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Every value is{" "}
            <span className="font-semibold text-foreground">AES-256-GCM encrypted</span> with a
            per-secret DEK, wrapped by an envelope KEK. Only a SHA-256 <em>fingerprint</em> and the
            last-4 characters ever leave the server. All create / rotate / delete events are
            hash-chained into <code>audit_log</code>.
          </p>
        </div>
        <Button onClick={() => setAdding(true)}>
          <Plus className="mr-1 h-4 w-4" /> Add secret
        </Button>
      </header>

      <div className="grid gap-3 md:grid-cols-3">
        <Guarantee
          icon={Lock}
          label="Envelope encryption"
          body="AES-256-GCM with per-secret DEK; DEK wrapped by KEK."
        />
        <Guarantee
          icon={Fingerprint}
          label="Cryptographic fingerprint"
          body="SHA-256 of plaintext + last-4 characters only."
        />
        <Guarantee
          icon={KeyRound}
          label="Rotation & rollback"
          body="Append-only version history; every rotation audited."
        />
      </div>

      {q.isLoading && (
        <div className="rounded-md border border-border p-6 text-sm text-muted-foreground">
          Loading secrets…
        </div>
      )}
      {q.error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {(q.error as Error).message}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Class</th>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-left">Fingerprint</th>
              <th className="px-3 py-2 text-left">Last-4</th>
              <th className="px-3 py-2 text-left">KEK</th>
              <th className="px-3 py-2 text-left">Version</th>
              <th className="px-3 py-2 text-left">Rotated</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {(q.data ?? []).map((s: Record<string, unknown>) => (
              <SecretRow key={s.id as string} row={s} />
            ))}
            {q.data?.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  No secrets in the platform vault yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {adding && <NewSecretModal onClose={() => setAdding(false)} />}
    </div>
  );
}

function Guarantee({
  icon: Icon,
  label,
  body,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  body: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-primary">
        <Icon className="h-4 w-4" />
        <span className="text-sm font-semibold text-foreground">{label}</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{body}</p>
    </div>
  );
}

function SecretRow({ row }: { row: Record<string, unknown> }) {
  const qc = useQueryClient();
  const delFn = useServerFn(deleteVaultSecret);
  const rotFn = useServerFn(putVaultSecret);
  const logFn = useServerFn(listVaultRotationLog);
  const [rotating, setRotating] = useState(false);
  const [newVal, setNewVal] = useState("");
  const [reason, setReason] = useState("");
  const [showLog, setShowLog] = useState(false);

  const del = useMutation({
    mutationFn: () => delFn({ data: { id: row.id as string } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["vault", "platform"] }),
  });
  const rot = useMutation({
    mutationFn: () =>
      rotFn({
        data: {
          scope: "platform",
          secret_class: row.secret_class as SecretClass,
          name: row.name as string,
          plaintext: newVal,
          reason: reason || "manual rotation",
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vault", "platform"] });
      setRotating(false);
      setNewVal("");
      setReason("");
    },
  });
  const logQ = useQuery({
    queryKey: ["vault", "log", row.id],
    queryFn: () => logFn({ data: { secret_id: row.id as string } }),
    enabled: showLog,
  });

  return (
    <>
      <tr className="border-t border-border">
        <td className="px-3 py-2">
          <Badge variant="outline">{String(row.secret_class)}</Badge>
        </td>
        <td className="px-3 py-2 font-mono text-xs">{String(row.name)}</td>
        <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
          {String(row.fingerprint_sha256 ?? "").slice(0, 16)}…
        </td>
        <td className="px-3 py-2 font-mono text-xs">****{String(row.last4 ?? "")}</td>
        <td className="px-3 py-2 text-xs">
          {String(row.kek_provider)}:{String(row.kek_ref)}
        </td>
        <td className="px-3 py-2 text-xs">v{String(row.version)}</td>
        <td className="px-3 py-2 text-xs text-muted-foreground">
          {row.rotated_at ? new Date(String(row.rotated_at)).toLocaleString() : "—"}
        </td>
        <td className="px-3 py-2 text-right">
          <Button size="sm" variant="ghost" onClick={() => setShowLog((v) => !v)}>
            Log
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Rotate ${String(row.name)}`}
            title={`Rotate ${String(row.name)}`}
            onClick={() => setRotating((v) => !v)}
          >
            <RotateCw className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Delete ${String(row.name)}`}
            title={`Delete ${String(row.name)}`}
            onClick={() => {
              if (confirm("Delete this secret? Audit-logged.")) del.mutate();
            }}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </td>
      </tr>
      {rotating && (
        <tr className="border-t border-border bg-muted/30">
          <td colSpan={8} className="px-3 py-3">
            <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
              <PasswordInput
                revealLabel="new secret value"
                placeholder="New secret value"
                value={newVal}
                onChange={(e) => setNewVal(e.target.value)}
              />
              <Input
                placeholder="Reason (audited)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <Button size="sm" onClick={() => rot.mutate()} disabled={!newVal || rot.isPending}>
                Rotate
              </Button>
            </div>
            {rot.error && (
              <div className="mt-2 text-xs text-destructive">{(rot.error as Error).message}</div>
            )}
          </td>
        </tr>
      )}
      {showLog && (
        <tr className="border-t border-border bg-muted/20">
          <td colSpan={8} className="px-3 py-3">
            {logQ.isLoading && (
              <div className="text-xs text-muted-foreground">Loading rotation log…</div>
            )}
            {logQ.data && (
              <div className="space-y-1 text-xs">
                {(logQ.data as Array<Record<string, unknown>>).map((l) => (
                  <div
                    key={String(l.id)}
                    className="flex flex-wrap gap-2 rounded border border-border bg-background p-2 font-mono"
                  >
                    <span>{String(l.rotated_at)}</span>
                    <span>
                      v{String(l.from_version)}→v{String(l.to_version)}
                    </span>
                    <span className="text-muted-foreground">
                      {String(l.from_fingerprint ?? "").slice(0, 12)}…→
                      {String(l.to_fingerprint ?? "").slice(0, 12)}…
                    </span>
                    <span className="text-muted-foreground">{String(l.reason ?? "")}</span>
                  </div>
                ))}
                {(logQ.data as unknown[]).length === 0 && (
                  <div className="text-muted-foreground">No rotations yet.</div>
                )}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function NewSecretModal({ onClose }: { onClose: () => void }) {
  const putFn = useServerFn(putVaultSecret);
  const qc = useQueryClient();
  const [cls, setCls] = useState<SecretClass>("generic");
  const [name, setName] = useState("");
  const [plaintext, setPlaintext] = useState("");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr(null);
    setBusy(true);
    try {
      if (!name.trim() || !plaintext.trim()) throw new Error("Name and value are required.");
      await putFn({
        data: {
          scope: "platform",
          secret_class: cls,
          name,
          plaintext,
          reason: reason || undefined,
        },
      });
      await qc.invalidateQueries({ queryKey: ["vault", "platform"] });
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4">
      <div className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-xl">
        <h3 className="flex items-center gap-2 font-display text-lg font-semibold">
          <KeyRound className="h-5 w-5 text-primary" /> Add secret to vault
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Value is encrypted server-side. Only a SHA-256 fingerprint and last-4 chars will be
          visible.
        </p>
        <div className="mt-4 space-y-3">
          <div>
            <Label className="text-xs">Secret class</Label>
            <Select value={cls} onValueChange={(v) => setCls(v as SecretClass)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SECRET_CLASSES.map((c) => (
                  <SelectItem key={c.key} value={c.key}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Name (unique per class)</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. muse_prod_key"
            />
          </div>
          <div>
            <Label className="text-xs">Value</Label>
            <Textarea
              rows={3}
              value={plaintext}
              onChange={(e) => setPlaintext(e.target.value)}
              className="font-mono text-xs"
            />
          </div>
          <div>
            <Label className="text-xs">Reason (audited)</Label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Optional"
            />
          </div>
        </div>
        {err && <div className="mt-3 text-xs text-destructive">{err}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? "Encrypting…" : "Encrypt & store"}
          </Button>
        </div>
      </div>
    </div>
  );
}
