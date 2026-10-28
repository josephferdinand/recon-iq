import { createFileRoute } from "@tanstack/react-router";
import { HubShell } from "@/components/hub-shell";
import { KeyRound, Lock, RotateCcw, ShieldCheck, Fingerprint, Vault } from "lucide-react";

export const Route = createFileRoute("/_authenticated/hub/vault")({
  head: () => ({
    meta: [
      { title: "Key & Secret Vault — Platform | ReconIQ" },
      { name: "description", content: "Secrets, BYOK, CMEK, and vault access approvals in one hub." },
    ],
  }),
  component: () => (
    <HubShell
      eyebrow="Platform"
      title="Key & Secret Vault"
      intro="Enterprise vault: secrets, BYOK, CMEK, rotation policies, and access approvals — all pluggable across Azure KV / AWS SM / HashiCorp / GCP SM / Internal."
      entries={[
        { title: "Secrets", description: "App vault secrets & versions.", href: "/platform?page=vault", icon: Vault },
        { title: "BYOK keys", description: "Customer-owned keys and shares.", href: "/platform?page=vault", icon: KeyRound },
        { title: "CMEK keys", description: "Customer-managed encryption keys.", href: "/platform?page=vault", icon: Lock },
        { title: "Rotation policies", description: "Rotation schedule and log.", href: "/platform?page=vault", icon: RotateCcw },
        { title: "Access approvals", description: "Just-in-time secret access.", href: "/platform?page=vault", icon: ShieldCheck },
        { title: "KMS bindings", description: "App-vault ↔ KMS bindings.", href: "/platform?page=vault", icon: Fingerprint },
      ]}
    />
  ),
});
