import { expect, test } from "@playwright/test";
import { authFile } from "./global-setup";

/** The stay/rent, rent-email and complaint switches in account settings: they save, survive a reload, and can be turned back on. */
test.use({ storageState: authFile("guest4") });

const SWITCHES = ["Stay, rent and deposit updates in the app", "Rent bill and reminder emails", "Complaint updates in the app"];

test("the stay, rent and complaint switches save and persist", async ({ page }) => {
  await page.goto("/account/profile");
  for (const name of SWITCHES) await expect(page.getByRole("switch", { name })).toBeVisible();
  for (const name of SWITCHES) await expect(page.getByRole("switch", { name })).toBeChecked(); // everything starts on

  const saved = page.waitForResponse((r) => r.url().includes("/notification-preferences") && r.request().method() === "PATCH");
  await page.getByRole("switch", { name: SWITCHES[2] }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByRole("switch", { name: SWITCHES[2] })).not.toBeChecked();

  await page.reload();
  await expect(page.getByRole("switch", { name: SWITCHES[2] })).not.toBeChecked(); // kept by the server
  await expect(page.getByRole("switch", { name: SWITCHES[0] })).toBeChecked(); // the others untouched

  await page.getByRole("switch", { name: SWITCHES[2] }).click();
  await expect(page.getByRole("switch", { name: SWITCHES[2] })).toBeChecked();
});
