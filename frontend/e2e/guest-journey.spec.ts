import { expect, test, type Page } from "@playwright/test";
import { authFile } from "./global-setup";
import { cancelOpenBookings, expectNoConsoleErrors, inDays } from "./helpers";

/** Opens the Goa instant-book property with a one-bed selection for the given stay, up to the checkout page. */
async function startCheckout(page: Page, from: number, nights: number, guestName: string, phone: string) {
  await page.goto("/search?city=Goa");
  await page.getByRole("link", { name: /Palolem Beach Nomads/ }).first().click();
  await page.waitForURL(/\/hostels\//);
  const base = new URL(page.url()).pathname;
  await page.goto(`${base}?checkIn=${inDays(from)}&checkOut=${inDays(from + nights)}&guests=1`);
  await page.getByRole("button", { name: /Add one bed/ }).first().click();
  const reserve = page.getByRole("link", { name: /^Reserve/ }).first();
  await expect(reserve).toBeVisible();
  await expect(page.getByText("GST").first()).toBeVisible(); // the price is itemised before the guest commits
  await reserve.click();
  await expect(page.getByRole("heading", { name: "Review and book" })).toBeVisible();
  await page.getByLabel("Full name (as on ID)").first().fill(guestName);
  await page.getByLabel(/Mobile number/).fill(phone);
}

test.describe("signed-in guest", () => {
  test.use({ storageState: authFile("guest3") });

  test("search → book → demo-pay → confirmed → cancel with refund", async ({ page }) => {
    await cancelOpenBookings(page); // leftovers from earlier runs would hit the open-booking cap
    await expectNoConsoleErrors(page, async () => {
      await startCheckout(page, 45, 2, "Guest Three", "+919876543210");
      await page.getByRole("button", { name: /Continue to payment/ }).first().click();

      // the booking page opens the payment sheet
      await expect(page).toHaveURL(/\/account\/bookings\/[0-9a-f-]{36}/);
      await expect(page.getByRole("heading", { name: "Complete your payment" })).toBeVisible();
      await expect(page.getByText("Demo payment")).toBeVisible();
      await page.getByRole("button", { name: /^Pay ₹/ }).click();
      await expect(page.getByText("You're booked")).toBeVisible({ timeout: 40_000 }); // confirmation arrives by webhook through the worker
      await page.getByRole("button", { name: "View booking" }).click();
      await expect(page.getByText("Confirmed", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("You're all set")).toBeVisible();

      // cancelling shows what comes back before committing
      await page.getByRole("button", { name: "Cancel booking" }).click();
      await expect(page.getByText(/You'll get .* back/)).toBeVisible();
      await page.getByRole("button", { name: "Yes, cancel booking" }).click();
      await expect(page.getByText("You cancelled this booking")).toBeVisible();
      await expect(page.getByText(/Refund (on its way|sent)/)).toBeVisible({ timeout: 20_000 });
    });
  });
});

test.describe("payment retries", () => {
  test.use({ storageState: authFile("guest4") });

  test("a declined payment can be retried and then succeeds", async ({ page }) => {
    await cancelOpenBookings(page);
    await startCheckout(page, 60, 1, "Guest Four", "+919876543211");
    await page.getByRole("button", { name: /Continue to payment/ }).first().click();
    await expect(page.getByRole("heading", { name: "Complete your payment" })).toBeVisible();

    await page.getByText("Payment fails").click();
    await page.getByRole("button", { name: /^Pay ₹/ }).click();
    await expect(page.getByText("Payment didn't go through")).toBeVisible({ timeout: 40_000 });
    await page.getByText("Pay successfully").click();
    await page.getByRole("button", { name: /^Pay ₹/ }).click(); // a fresh order was created for the retry
    await expect(page.getByText("You're booked")).toBeVisible({ timeout: 40_000 });
    await page.getByRole("button", { name: "View booking" }).click();
    await page.getByRole("button", { name: "Cancel booking" }).click(); // clean up so reruns keep their beds
    await page.getByRole("button", { name: "Yes, cancel booking" }).click();
    await expect(page.getByText("You cancelled this booking")).toBeVisible();
  });
});

test.describe("signing in", () => {
  test("signed-out visitors are sent to sign in and come back where they were", async ({ page }) => {
    await page.goto("/account/bookings");
    await expect(page).toHaveURL(/\/login\?next=%2Faccount%2Fbookings/);
    await page.locator("#email").fill("guest2@hostel.dev");
    await page.locator("#password").fill("Password@123");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/account\/bookings$/);
    await expect(page.getByRole("heading", { name: "Your trips" })).toBeVisible();
  });

  test("a wrong password shows a clear error and keeps you on the page", async ({ page }) => {
    await page.goto("/login");
    await page.locator("#email").fill(`nobody+${Date.now()}@example.com`);
    await page.locator("#password").fill("not-the-password1");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText(/don't match/)).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("validation errors appear inline before anything is sent", async ({ page }) => {
    await page.goto("/register");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("Enter your full name")).toBeVisible();
    await expect(page.getByText("Enter your email")).toBeVisible();
    await expect(page.getByText("Use at least 8 characters")).toBeVisible();
  });
});
