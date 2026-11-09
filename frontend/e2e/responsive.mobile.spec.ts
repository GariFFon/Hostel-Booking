import { expect, test } from "@playwright/test";
import { authFile } from "./global-setup";

/** Phone layout: nothing scrolls sideways, and the bottom edge belongs to the right control on each screen. */
const ROUTES = ["/", "/search?city=Goa", "/hostels/palolem-beach-nomads-goa", "/host", "/login", "/register"];
const SIGNED_IN: [string, "guest3" | "owner1" | "admin"][] = [["/account/bookings", "guest3"], ["/account/profile", "guest3"], ["/owner", "owner1"], ["/owner/hostels/new", "owner1"], ["/owner/calendar", "owner1"], ["/admin/audit", "admin"]];

async function noSidewaysScroll(page: import("@playwright/test").Page, path: string) {
  await page.goto(path, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, `horizontal overflow on ${path}`).toBeLessThanOrEqual(0);
}

for (const width of [320, 390]) {
  test.describe(`${width}px wide`, () => {
    test.use({ viewport: { width, height: 800 } });
    for (const p of ROUTES) test(`no sideways scroll: ${p}`, async ({ page }) => { await noSidewaysScroll(page, p); });
    for (const [p, who] of SIGNED_IN) {
      test.describe(who, () => {
        test.use({ storageState: authFile(who) });
        test(`no sideways scroll: ${p}`, async ({ page }) => { await noSidewaysScroll(page, p); });
      });
    }
  });
}

test("the tab bar is on browse and account screens, and gives way to the booking bar on a property page", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: authFile("guest3"), viewport: { width: 390, height: 800 }, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto("/account/bookings");
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  await page.goto("/hostels/palolem-beach-nomads-goa");
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeHidden();
  await expect(page.getByRole("button", { name: /Check dates/ })).toBeVisible();
  await ctx.close();
});

test("filters open as a draggable bottom sheet on phones", async ({ page }) => {
  await page.goto("/search?city=Goa");
  await page.getByRole("button", { name: /Filters/ }).click();
  const sheet = page.getByRole("dialog", { name: "Filters" });
  await expect(sheet).toBeVisible();
  const box = await sheet.boundingBox();
  expect(box!.y + box!.height).toBeGreaterThan(700); // anchored to the bottom edge
  await sheet.getByRole("radio", { name: "Private room" }).click();
  await sheet.getByRole("button", { name: "Show results" }).click();
  await expect(page).toHaveURL(/roomKind=PRIVATE/);
});

test("the host menu is a slide-in panel on phones", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: authFile("owner1"), viewport: { width: 390, height: 800 }, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto("/owner");
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("link", { name: "Bookings" }).click();
  await expect(page).toHaveURL(/\/owner\/bookings/);
  await ctx.close();
});
