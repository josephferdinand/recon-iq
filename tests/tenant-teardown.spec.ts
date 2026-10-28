import { describe, expect, it, vi } from "vitest";

import { purgeTestTenants } from "./helpers/tenant-teardown";

function mockAdmin(options?: {
  purgeErrorById?: Record<string, string>;
  readbackErrorById?: Record<string, string>;
  residueIds?: string[];
}) {
  const current = { id: "" };
  const rpc = vi.fn(async (_name: string, args: { _tenant_id: string }) => ({
    error: options?.purgeErrorById?.[args._tenant_id]
      ? { message: options.purgeErrorById[args._tenant_id] }
      : null,
  }));
  const maybeSingle = vi.fn(async () => ({
    data: options?.residueIds?.includes(current.id) ? { id: current.id } : null,
    error: options?.readbackErrorById?.[current.id]
      ? { message: options.readbackErrorById[current.id] }
      : null,
  }));
  const eq = vi.fn((_column: string, id: string) => {
    current.id = id;
    return { maybeSingle };
  });
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));

  return { client: { rpc, from } as never, rpc, from, select, eq, maybeSingle };
}

describe("purgeTestTenants", () => {
  it("purges each unique tenant and proves zero row residue", async () => {
    const admin = mockAdmin();

    await expect(
      purgeTestTenants(admin.client, ["tenant-a", null, "tenant-a", "tenant-b"], "teardown.spec.ts"),
    ).resolves.toBeUndefined();

    expect(admin.rpc).toHaveBeenCalledTimes(2);
    expect(admin.maybeSingle).toHaveBeenCalledTimes(2);
  });

  it("attempts every target and fails when purge or readback does not prove cleanup", async () => {
    const admin = mockAdmin({
      purgeErrorById: { "tenant-a": "purge rejected" },
      residueIds: ["tenant-b"],
    });

    await expect(
      purgeTestTenants(admin.client, ["tenant-a", "tenant-b"], "teardown.spec.ts"),
    ).rejects.toThrow(/purge tenant-a: purge rejected; residue tenant-b/u);

    expect(admin.rpc).toHaveBeenCalledTimes(2);
  });

  it("fails when the post-purge readback cannot be completed", async () => {
    const admin = mockAdmin({ readbackErrorById: { "tenant-a": "readback unavailable" } });

    await expect(
      purgeTestTenants(admin.client, ["tenant-a"], "teardown.spec.ts"),
    ).rejects.toThrow(/readback tenant-a: readback unavailable/u);
  });
});
