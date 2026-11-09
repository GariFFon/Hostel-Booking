import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { authFile } from "./global-setup";

/** WCAG 2.1 A/AA scan of the main screens. Serious and critical violations fail the build. */
const PUBLIC = ["/", "/search?city=Goa", "/hostels/palolem-beach-nomads-goa", "/host", "/login", "/register", "/forgot-password"];
const SIGNED_IN: [string, "guest3" | "owner1" | "admin"][] = [
  ["/account/bookings", "guest3"], ["/account/wishlist", "guest3"], ["/account/notifications", "guest3"], ["/account/profile", "guest3"],
  ["/owner", "owner1"], ["/owner/hostels", "owner1"], ["/owner/bookings", "owner1"], ["/owner/coupons", "owner1"], ["/owner/verification", "owner1"],
  ["/admin", "admin"], ["/admin/hostels", "admin"], ["/admin/audit", "admin"],
];

async function scan(page: import("@playwright/test").Page, path: string) {
  await page.goto(path, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  const res = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const bad = res.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`), `a11y on ${path}`).toEqual([]);
}

for (const path of PUBLIC) test(`a11y: ${path}`, async ({ page }) => { await scan(page, path); });
for (const [path, who] of SIGNED_IN) {
  test.describe(`signed in as ${who}`, () => {
    test.use({ storageState: authFile(who) });
    test(`a11y: ${path}`, async ({ page }) => { await scan(page, path); });
  });
}
