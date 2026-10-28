import { expect, test } from "@playwright/test";

test("recovery callback errors are actionable and removed from browser history", async ({
  page,
}) => {
  await page.goto(
    "/reset-password?error=access_denied&error_description=Recovery%20link%20expired&type=recovery",
  );

  await expect(page.getByRole("alert")).toContainText("This reset link is not valid");
  await expect(page.getByRole("alert")).toContainText("Recovery link expired");
  await expect(page.getByRole("link", { name: "Request a new one" })).toBeVisible();
  await expect(page).toHaveURL(/\/reset-password$/);
});

test("a callback with no recoverable session stops validating after the bounded timeout", async ({
  page,
}) => {
  await page.goto("/reset-password");

  await expect(page.getByText("Validating reset link…")).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("This reset link could not be validated", {
    timeout: 12_000,
  });
  await expect(page.getByRole("link", { name: "Request a new one" })).toBeVisible();
});

test("the confirmation interstitial does not consume a token until the user continues", async ({
  page,
}) => {
  let verificationRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/auth/v1/verify")) verificationRequests += 1;
  });

  await page.goto(
    "/confirm-auth?token_hash=deliberately-invalid-test-hash&type=recovery&redirect_to=%2Freset-password",
  );

  const continueButton = page.getByRole("button", { name: "Continue password reset" });
  await expect(continueButton).toBeVisible();
  await expect(page).toHaveURL(/\/confirm-auth$/);
  expect(verificationRequests).toBe(0);

  await continueButton.click();
  await expect(page.getByRole("alert")).toContainText("This verification link is not valid");
  expect(verificationRequests).toBe(1);
});
