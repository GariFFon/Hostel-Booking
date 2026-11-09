import { expect, type Page } from "@playwright/test";

export const PASSWORD = "Password@123";

export async function login(page: Page, email: string, next?: string) {
  await page.goto(`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(PASSWORD);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login")), page.getByRole("button", { name: "Sign in", exact: true }).click()]);
}

/** A date `days` from now as YYYY-MM-DD (local), for stays far enough ahead to always be bookable. */
export function inDays(days: number) {
  const d = new Date(Date.now() + days * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function expectNoConsoleErrors(page: Page, fn: () => Promise<void>) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|tile\.openstreetmap|res\.cloudinary/.test(m.text())) errors.push(m.text()); });
  await fn();
  expect(errors, "browser console errors").toEqual([]);
}

/** Cancels the signed-in user's unpaid/open bookings (from inside the page, so cookies and origin are the browser's own). */
export async function cancelOpenBookings(page: Page) {
  await page.goto("/");
  await page.evaluate(async () => {
    const list = await (await fetch("/api/bff/bookings?when=upcoming&limit=50")).json();
    for (const b of list.data ?? []) {
      if (["PENDING_PAYMENT", "PENDING_APPROVAL", "CONFIRMED"].includes(b.status)) {
        await fetch(`/api/bff/bookings/${b.id}/cancel`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      }
    }
  });
}
