import { expect, test, type Browser, type Page } from "@playwright/test";
import { authFile } from "./global-setup";
import { cancelOpenBookings, inDays } from "./helpers";

// 1x1 PNG: a real, valid image (Cloudinary accepts it), so the signed direct upload is exercised for real.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const rand = () => Math.random().toString(36).slice(2, 7);

async function as(browser: Browser, who: "owner1" | "owner2" | "owner3" | "admin" | "guest2") {
  const ctx = await browser.newContext({ storageState: authFile(who) });
  return { ctx, page: await ctx.newPage() };
}

test.describe("host and admin", () => {
  test("a host creates a property, an admin approves it, and guests can find it", async ({ browser }) => {
    const name = `E2E Hostel ${rand()}`;
    const host = await as(browser, "owner1");
    const p = host.page;

    // ── create the draft ──
    await p.goto("/owner/hostels/new");
    await p.getByLabel(/Property name/).fill(name);
    await p.getByLabel(/^Description/).fill("A tidy test hostel with friendly staff, bright dorms and a quiet common room for travellers.");
    await p.locator(".leaflet-container").click({ position: { x: 200, y: 140 } }); // drops the pin
    await expect(p.getByText(/Pinned at/)).toBeVisible();
    await p.getByLabel(/Street address/).fill("12 Test Lane");
    await p.getByLabel(/^City/).fill("Testville");
    await p.getByLabel(/^State/).fill("Goa");
    await p.getByLabel(/PIN code/).fill("403001");
    await p.getByRole("button", { name: "Create and continue" }).click();
    await expect(p).toHaveURL(/\/owner\/hostels\/[0-9a-f-]{36}\?tab=photos/);
    const hostelUrl = p.url().split("?")[0]!;
    await expect(p.getByRole("heading", { level: 1, name: new RegExp(name) })).toBeVisible();

    // an incomplete draft cannot be submitted, and says why
    await expect(p.getByText("Before you submit")).toBeVisible();
    await expect(p.getByRole("button", { name: "Submit for review" })).toBeDisabled();

    // ── photos: three real direct uploads to Cloudinary ──
    await p.locator('input[type="file"][accept*="image/jpeg"]').setInputFiles([1, 2, 3].map((i) => ({ name: `photo${i}.png`, mimeType: "image/png", buffer: PNG })));
    await expect(p.getByRole("img", { name: /Photo 3/ })).toBeVisible({ timeout: 60_000 });
    await expect(p.getByText("Cover", { exact: true })).toBeVisible();

    // ── rooms and a weekend price rule ──
    await p.goto(`${hostelUrl}?tab=rooms`);
    await p.getByRole("button", { name: "Add your first room type" }).click();
    await p.getByLabel(/^Name/).fill("6-bed mixed dorm");
    await p.getByLabel(/Price \(₹/).fill("750");
    await p.getByRole("button", { name: "Add room type" }).click();
    await expect(p.getByRole("heading", { name: "6-bed mixed dorm" })).toBeVisible();
    await p.getByRole("button", { name: "Special prices" }).click();
    await p.getByRole("button", { name: "Add a rule" }).click();
    await p.getByRole("button", { name: "Add rule" }).click();
    await expect(p.getByText("Weekend rate")).toBeVisible();
    await p.keyboard.press("Escape");

    // ── submit ──
    await p.goto(hostelUrl);
    await expect(p.getByText("Identity verified")).toBeVisible();
    await p.getByRole("button", { name: "Submit for review" }).click();
    await p.getByRole("button", { name: "Submit", exact: true }).click();
    await expect(p.getByText("Our team is checking this listing.")).toBeVisible();

    // ── the admin reviews and approves ──
    const admin = await as(browser, "admin");
    const a = admin.page;
    await a.goto("/admin/hostels");
    await a.getByRole("link", { name: new RegExp(name) }).click();
    await expect(a.getByRole("heading", { level: 1, name: new RegExp(name) })).toBeVisible();
    await expect(a.getByText("Photos (3)")).toBeVisible();
    await a.getByRole("button", { name: "Approve" }).click();
    await a.getByRole("button", { name: "Approve and publish" }).click();
    await expect(a.getByText("Live", { exact: true }).first()).toBeVisible();

    // ── it is now public: search finds it and the page loads with its room ──
    const guest = await browser.newContext();
    const g = await guest.newPage();
    await g.goto(`/search?q=${encodeURIComponent(name)}`);
    await g.getByRole("link", { name: new RegExp(name) }).first().click();
    await expect(g.getByRole("heading", { level: 1, name: new RegExp(name) })).toBeVisible();
    await expect(g.getByText("6-bed mixed dorm").first()).toBeVisible();

    // ── clean up: the host deletes the test property ──
    await p.goto(hostelUrl);
    await p.getByRole("button", { name: "Delete property" }).click();
    await p.getByRole("button", { name: "Delete property" }).last().click();
    await expect(p).toHaveURL(/\/owner\/hostels$/);
    await Promise.all([host.ctx.close(), admin.ctx.close(), guest.close()]);
  });

  test("request-to-book: the guest asks, the host accepts, the guest pays", async ({ browser }) => {
    const guest = await as(browser, "guest2");
    const host = await as(browser, "owner3"); // Koregaon Park Students PG is hosted by the third seed owner
    const g = guest.page, h = host.page;
    await cancelOpenBookings(g);

    // the guest requests a 7-night stay at the (men-only, request-to-book) PG
    await g.goto("/search?city=Pune");
    await g.getByRole("link", { name: /Koregaon Park Students PG/ }).first().click();
    await g.waitForURL(/\/hostels\//);
    const base = new URL(g.url()).pathname;
    await g.goto(`${base}?checkIn=${inDays(80)}&checkOut=${inDays(87)}&guests=1`);
    await g.getByRole("button", { name: /Add one bed/ }).first().click();
    await g.getByRole("link", { name: /^Request to book/ }).first().click();
    await expect(g.getByRole("heading", { name: "Request to book" })).toBeVisible();
    await expect(g.getByText(/You pay only if they accept/).first()).toBeVisible();
    await g.getByLabel("Full name (as on ID)").first().fill("Guest Two");
    await g.getByLabel("Gender").click(); // men-only property: gender is required for every guest
    await g.getByRole("option", { name: "Male", exact: true }).click();
    await g.getByLabel(/Mobile number/).fill("+919876543212");
    await g.getByRole("button", { name: "Send request" }).first().click();
    await expect(g).toHaveURL(/\/account\/bookings\/[0-9a-f-]{36}/);
    await expect(g.getByText("Waiting for the host")).toBeVisible();
    const bookingId = g.url().match(/bookings\/([0-9a-f-]{36})/)![1]!;

    // the host sees the request (and was notified), then accepts
    await h.goto("/owner/bookings?tab=requests");
    await expect(h.locator(`a[href="/owner/bookings/${bookingId}"]`).first()).toBeVisible(); // the request is in the host's queue
    await h.goto("/account/notifications");
    await expect(h.getByText("New booking request").first()).toBeVisible();
    await h.goto(`/owner/bookings/${bookingId}`);
    await h.getByRole("button", { name: "Accept" }).click();
    await expect(h.getByText("Waiting for the guest to pay")).toBeVisible();

    // the guest can now pay
    await g.reload();
    await expect(g.getByText(/Your beds are held for/)).toBeVisible();
    await g.getByRole("button", { name: /^Pay ₹/ }).first().click();
    await g.getByRole("dialog").getByRole("button", { name: /^Pay ₹/ }).click();
    await expect(g.getByText("You're booked")).toBeVisible({ timeout: 40_000 });
    await g.getByRole("button", { name: "View booking" }).click();

    // clean up
    await g.getByRole("button", { name: "Cancel booking" }).click();
    await g.getByRole("button", { name: "Yes, cancel booking" }).click();
    await expect(g.getByText("You cancelled this booking")).toBeVisible();
    await Promise.all([guest.ctx.close(), host.ctx.close()]);
  });

  test("a host's public coupon shows up for guests and applies to the price", async ({ browser }) => {
    const code = `E2E${rand().toUpperCase()}`;
    const host = await as(browser, "owner1");
    const h = host.page;
    await h.goto("/owner/coupons");
    await h.getByRole("button", { name: "New coupon" }).first().click();
    await h.getByRole("combobox", { name: "Property" }).click(); // a host with several properties must pick which one the code is for
    await h.getByRole("option", { name: /Palolem Beach Nomads/ }).click();
    await h.getByLabel(/^Code/).fill(code);
    await h.getByLabel(/Percent off/).fill("10");
    await h.getByLabel(/Valid until/).fill(inDays(200));
    await h.getByRole("switch").first().click(); // public
    await h.getByRole("button", { name: "Create coupon" }).click();
    await expect(h.getByText(code, { exact: true })).toBeVisible();

    const guest = await browser.newContext();
    const g = await guest.newPage();
    await g.goto("/search?city=Goa");
    await g.getByRole("link", { name: /Palolem Beach Nomads/ }).first().click();
    await g.waitForURL(/\/hostels\//);
    const base = new URL(g.url()).pathname;
    await g.goto(`${base}?checkIn=${inDays(100)}&checkOut=${inDays(102)}&guests=1`);
    await g.getByRole("button", { name: /Add one bed/ }).first().click();
    await g.getByText("Have a coupon?").click();
    await g.getByRole("button", { name: new RegExp(code) }).click(); // the offer chip applies the code
    await expect(g.getByText(new RegExp(`${code} applied`))).toBeVisible();
    await expect(g.getByText(/^Discount/)).toBeVisible();

    // clean up: a coupon nobody used can be deleted
    await h.getByRole("button", { name: `Delete ${code}` }).click();
    await h.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(h.getByText(code, { exact: true })).toHaveCount(0);
    await Promise.all([host.ctx.close(), guest.close()]);
  });

  test("an admin moderates a review (hide with a reason, then restore) and verifies the audit chain", async ({ browser }) => {
    const admin = await as(browser, "admin");
    const a: Page = admin.page;
    await a.goto("/admin/reviews");
    const first = a.locator("article").first();
    await expect(first).toBeVisible();
    await first.getByRole("button", { name: "Hide" }).click();
    await a.getByLabel(/^Reason/).fill("E2E moderation check");
    await a.getByRole("button", { name: "Hide review" }).last().click();
    await a.getByRole("radio", { name: "Hidden" }).click();
    await expect(a.getByText("E2E moderation check").first()).toBeVisible();
    await a.locator("article", { hasText: "E2E moderation check" }).first().getByRole("button", { name: "Restore" }).click();
    await expect(a.getByText("E2E moderation check")).toHaveCount(0);

    await a.goto("/admin/audit");
    await expect(a.getByText("review.hide").first()).toBeVisible();
    await a.getByRole("button", { name: "Verify chain" }).click();
    await expect(a.getByText("Chain intact")).toBeVisible();
    await admin.ctx.close();
  });

  test("hosts can't open the admin area and guests can't open the host area", async ({ browser }) => {
    const host = await as(browser, "owner1");
    await host.page.goto("/admin");
    await expect(host.page.getByText("You don't have access to this area")).toBeVisible();
    const guest = await as(browser, "guest2");
    await guest.page.goto("/owner");
    await expect(guest.page.getByText("Become a host to list your property")).toBeVisible();
    await Promise.all([host.ctx.close(), guest.ctx.close()]);
  });
});
