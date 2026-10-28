import { expect, test } from "@playwright/test";

const tenant = "reconiq-assurance-lab-prod";
const pipeline = "00000000-0000-4000-8000-000000000001";

test("Data Prep API exposes allowed-origin preflight only", async ({ request }) => {
  const allowed = await request.fetch(`/api/v1/${tenant}/data-prep/pipelines/`, {
    method: "OPTIONS",
    headers: { origin: "https://app.reconiq.example" },
  });
  expect(allowed.status()).toBe(204);
  expect(allowed.headers()["access-control-allow-origin"]).toBe("https://app.reconiq.example");
  expect(allowed.headers()["access-control-allow-methods"]).toContain("GET");
  expect(allowed.headers()["access-control-allow-methods"]).toContain("POST");

  const hostile = await request.fetch(`/api/v1/${tenant}/data-prep/pipelines/`, {
    method: "OPTIONS",
    headers: { origin: "https://hostile.invalid" },
  });
  expect(hostile.status()).toBe(204);
  expect(hostile.headers()["access-control-allow-origin"]).toBeUndefined();
});

test("Data Prep read and CRUD reject missing credentials", async ({ request }) => {
  const calls = [
    request.get(`/api/v1/${tenant}/data-prep/pipelines/`),
    request.post(`/api/v1/${tenant}/data-prep/pipelines/`, { data: {} }),
    request.get(`/api/v1/${tenant}/data-prep/pipelines/${pipeline}/`),
    request.patch(`/api/v1/${tenant}/data-prep/pipelines/${pipeline}/`, { data: {} }),
    request.delete(`/api/v1/${tenant}/data-prep/pipelines/${pipeline}/`, { data: { reason: "test" } }),
  ];
  for (const response of await Promise.all(calls)) {
    expect(response.status()).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: "missing_bearer" });
  }
});

test("Data Prep lifecycle endpoints reject missing credentials", async ({ request }) => {
  for (const suffix of ["approval", "staging", "promotion", "promotion/decision"]) {
    const response = await request.post(`/api/v1/${tenant}/data-prep/pipelines/${pipeline}/${suffix}`, { data: {} });
    expect(response.status()).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: "missing_bearer" });
  }
});
