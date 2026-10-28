// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const mockState = vi.hoisted(() => ({
  schedules: { data: [] as unknown, isPending: false, isError: false, refetch: vi.fn() },
  csa: {
    data: {
      agreements: [],
      versions: [],
      calls: [],
      disputes: [],
      settlements: [],
      current_user_id: "user-a",
    } as unknown,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
}));

vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => vi.fn(async () => []),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) =>
    queryKey[0] === "collateral-schedules" ? mockState.schedules : mockState.csa,
  useMutation: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

import { CollateralTab } from "@/components/collateral-tab";

afterEach(() => {
  cleanup();
  mockState.schedules = { data: [], isPending: false, isError: false, refetch: vi.fn() };
  mockState.csa = {
    data: {
      agreements: [],
      versions: [],
      calls: [],
      disputes: [],
      settlements: [],
      current_user_id: "user-a",
    },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  };
});

describe("collateral lifecycle UI contract", () => {
  it("shows honest empty states and makes no sample schedule or fake run cadence claim", () => {
    render(<CollateralTab tenantId="22222222-2222-4222-8222-222222222222" canWrite />);
    expect(screen.getByText(/Nothing to display yet/i)).toBeTruthy();
    expect(screen.getByText(/No governed agreements are recorded yet/i)).toBeTruthy();
    expect(screen.queryByText(/every weekday|synthetic example/i)).toBeNull();
    expect(screen.getByRole("button", { name: /New bilateral VM agreement/i })).toBeTruthy();
  });

  it("keeps a read-only user from seeing create actions", () => {
    render(<CollateralTab tenantId="22222222-2222-4222-8222-222222222222" canWrite={false} />);
    expect(screen.queryByRole("button", { name: /New bilateral VM agreement/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /New schedule/i })).toBeNull();
    expect(screen.getByText(/database enforces tenant-admin access/i)).toBeTruthy();
  });

  it("shows retry guidance on unavailable reads and never renders raw provider details", () => {
    mockState.schedules = { data: undefined, isPending: false, isError: true, refetch: vi.fn() };
    mockState.csa = { data: undefined, isPending: false, isError: true, refetch: vi.fn() };
    render(<CollateralTab tenantId="22222222-2222-4222-8222-222222222222" canWrite />);
    expect(screen.getByText(/Schedules could not be loaded/i)).toBeTruthy();
    expect(screen.getByText(/CSA lifecycle records could not be loaded/i)).toBeTruthy();
    expect(screen.queryByText(/PGRST|permission denied for table|select .* from/i)).toBeNull();
    expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(2);
  });
});
