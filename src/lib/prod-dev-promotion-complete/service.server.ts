import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import {
  signEnvironmentPackage,
  verifyEnvironmentPackage,
  type EnvironmentPackageEnvelope,
} from "../environment-package-file.server";
import {
  canonical,
  closure,
  references,
  validateSnapshot,
  validateMappings,
  movementSchema,
  commandSchema,
  addressSchema,
  resourceSchema,
  type Address,
  type Resource,
  type Movement,
  type Command,
} from "./protocol";
export class PromotionService {
  constructor(
    private caller: SupabaseClient,
    private admin: SupabaseClient,
    private actor: string,
    private runtimeRef: string,
    private claims: { sub?: unknown; aal?: unknown; exp?: unknown },
  ) {}
  private async rpc(name: string, args: Record<string, unknown>) {
    let r;
    try {
      r = await this.admin.rpc(name, args);
    } catch {
      throw Error("Outcome unconfirmed. Keep the request key and check its retained receipt.");
    }
    if (r.error) {
      if (["PT409", "23505", "23514", "42501", "22023"].includes(r.error.code))
        throw Error("Request refused: " + r.error.message);
      throw Error("Outcome unconfirmed. Keep the request key and check its retained receipt.");
    }
    return r.data;
  }
  private async assurance() {
    if (
      this.claims.sub !== this.actor ||
      this.claims.aal !== "aal2" ||
      typeof this.claims.exp !== "number" ||
      this.claims.exp * 1000 <= Date.now()
    )
      throw Error("Complete current MFA verification before promotion");
  }
  async inventory(tenantId: string): Promise<Resource[]> {
    const raw = await this.rpc("fvi_pdc_inventory", { _actor: this.actor, _tenant: tenantId });
    if (!Array.isArray(raw)) throw Error("Inventory unavailable");
    return raw.map((x) => {
      const r = resourceSchema.parse(x);
      r.dependencies = [...new Set([...r.dependencies, ...references(r.configuration)])];
      return r;
    });
  }
  async address(tenantId: string): Promise<Address> {
    return addressSchema.parse(
      await this.rpc("fvi_pdc_address", {
        _actor: this.actor,
        _tenant: tenantId,
        _runtime: this.runtimeRef,
      }),
    );
  }
  async overview(tenantId: string) {
    const [inventory, address, registry, movements] = await Promise.all([
      this.inventory(tenantId),
      this.address(tenantId),
      this.rpc("fvi_pdc_registry", { _actor: this.actor, _tenant: tenantId }),
      this.rpc("fvi_pdc_list", { _actor: this.actor, _tenant: tenantId }),
    ]);
    return {
      inventory,
      address,
      registry: registry as {
        environment: string;
        projectRef: string;
        enabled: boolean;
        held: boolean;
      }[],
      movements: (movements as unknown[]).map((x) => movementSchema.parse(x)),
    };
  }
  async command(input: Command): Promise<Movement> {
    const c = commandSchema.parse(input);
    await this.assurance();
    if (c.operation === "request") {
      if (!c.snapshot) throw Error("Snapshot required");
      const s = validateSnapshot(c.snapshot),
        address = await this.address(c.tenantId);
      if (canonical(address) !== canonical(s.source) || s.source.projectRef !== this.runtimeRef)
        throw Error("Request in the actual source environment");
      const current = await this.inventory(c.tenantId);
      const fresh = closure(
        s.root,
        s.group,
        s.resources.map((r) => r.key),
        current,
      );
      if (canonical(fresh) !== canonical(s.resources))
        throw Error("Source changed; refresh the dependency review");
    }
    if (c.operation === "approve" && c.mappings) {
      const m = movementSchema.parse(
        await this.rpc("fvi_pdc_read", { _actor: this.actor, _tenant: c.tenantId, _id: c.id }),
      );
      validateMappings(m.snapshot, c.mappings, await this.inventory(c.tenantId));
    }
    const body = canonical(c);
    return movementSchema.parse(
      await this.rpc("fvi_pdc_commit", {
        _actor: this.actor,
        _aal2: true,
        _runtime: this.runtimeRef,
        _command: c,
        _fingerprint: createHash("sha256").update(body).digest("hex"),
      }),
    );
  }
  async outcome(tenantId: string, key: string): Promise<Movement | null> {
    const r = await this.rpc("fvi_pdc_outcome", {
      _actor: this.actor,
      _tenant: tenantId,
      _key: key,
    });
    return r ? movementSchema.parse(r) : null;
  }
  async export(tenantId: string, id: string): Promise<EnvironmentPackageEnvelope> {
    await this.assurance();
    const m = movementSchema.parse(
      await this.rpc("fvi_pdc_export", {
        _actor: this.actor,
        _tenant: tenantId,
        _id: id,
        _runtime: this.runtimeRef,
      }),
    );
    return signEnvironmentPackage({
      protocol: "fvi-pdc-1",
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      movement: m,
    });
  }
  async receive(tenantId: string, key: string, envelope: EnvironmentPackageEnvelope) {
    await this.assurance();
    const signed = await verifyEnvironmentPackage(envelope);
    if (
      signed.protocol !== "fvi-pdc-1" ||
      typeof signed.expiresAt !== "string" ||
      !Number.isFinite(Date.parse(signed.expiresAt)) ||
      Date.parse(signed.expiresAt) < Date.now() ||
      Date.parse(signed.expiresAt) > Date.now() + 300000
    )
      throw Error("Signed package expired or unsupported");
    const m = movementSchema.parse(signed.movement);
    validateSnapshot(m.snapshot);
    if (
      m.stage !== "source_approved" ||
      m.snapshot.destination.tenantId !== tenantId ||
      m.snapshot.destination.projectRef !== this.runtimeRef
    )
      throw Error("Package is addressed to another destination");
    const actual = await this.address(tenantId);
    if (canonical(actual) !== canonical(m.snapshot.destination))
      throw Error("Destination identity changed");
    return this.command({ operation: "receive", tenantId, key, movement: m, note: "" });
  }
}
