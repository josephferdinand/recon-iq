import { expect, test } from "@playwright/test";

const tenant = "reconiq-assurance-lab-prod";
const requestId = "00000000-0000-4000-8000-000000000001";

test("Environment Delivery API exposes only allowed-origin preflight", async ({ request }) => {
  const allowed = await request.fetch(`/api/v1/${tenant}/environment-changes/`, {
    method: "OPTIONS",
    headers: { origin: "https://app.reconiq.example" },
  });
  expect(allowed.status()).toBe(204);
  expect(allowed.headers()["access-control-allow-origin"]).toBe(
    "https://app.reconiq.example",
  );
  expect(allowed.headers()["access-control-allow-methods"]).toContain("GET");
  expect(allowed.headers()["access-control-allow-methods"]).toContain("POST");

  const hostile = await request.fetch(`/api/v1/${tenant}/environment-changes/`, {
    method: "OPTIONS",
    headers: { origin: "https://hostile.invalid" },
  });
  expect(hostile.status()).toBe(204);
  expect(hostile.headers()["access-control-allow-origin"]).toBeUndefined();
});

test("Environment Delivery read and mutation routes reject missing credentials", async ({
  request,
}) => {
  const calls = [
    request.get(`/api/v1/${tenant}/environment-changes/`),
    request.post(`/api/v1/${tenant}/environment-changes/`, { data: {} }),
    request.get(`/api/v1/${tenant}/environment-changes/${requestId}/`),
    request.post(`/api/v1/${tenant}/environment-changes/${requestId}/decision`, {
      data: { approve: true },
    }),
  ];
  for (const response of await Promise.all(calls)) {
    expect(response.status()).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: "missing_bearer" });
  }
});
