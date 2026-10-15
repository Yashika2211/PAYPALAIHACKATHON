import { expect, test } from "@playwright/test";

test("buyer request → mandate → live negotiation → PayPal hold → AI-verified delivery → capture + payout", async ({ page }) => {
  await page.goto("/buy/new");
  await page.getByRole("button", { name: /Plan my request/ }).click();

  await page.getByRole("button", { name: "Sign mandate" }).click({ timeout: 90_000 });
  await expect(page.getByText("Mandate signed").first()).toBeVisible();

  await page.getByRole("button", { name: /Start negotiating/ }).click();
  await expect(page.getByText("Negotiation theater")).toBeVisible();

  // The rogue merchant's injection is blocked and quarantined.
  await expect(page.getByText("Blocked by Mandate Firewall")).toBeVisible({ timeout: 180_000 });
  await expect(page.getByText("Best bundle")).toBeVisible({ timeout: 240_000 });

  // Funds are held (authorized), not captured.
  await page.getByRole("button", { name: /sandbox test card/ }).click();
  const upload = page.getByRole("button", { name: "Use sample delivery photo" });
  await expect(upload.first()).toBeVisible();

  // Each merchant "delivers"; the AI checks the photo and the system captures the share.
  const lines = await upload.count();
  for (let i = 0; i < lines; i++) {
    await upload.first().click();
    await expect(page.locator("img[alt='Delivery photo']")).toHaveCount(i + 1, { timeout: 120_000 });
  }
  await expect(page.getByText("Delivery verified by AI").first()).toBeVisible();
  await expect(page.getByText(/payout \$/).first()).toBeVisible({ timeout: 60_000 });

  // Every PayPal call is visible in the debug panel.
  await page.getByText("PayPal API log").click();
  await expect(page.getByText("/v2/checkout/orders").first()).toBeVisible();
});

test("ledger streams rows and exports", async ({ page }) => {
  await page.goto("/ledger");
  await expect(page.locator(".ag-row").first()).toBeVisible({ timeout: 30_000 });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  expect((await download).suggestedFilename()).toMatch(/^haggle-ledger-.*\.csv$/);
});
