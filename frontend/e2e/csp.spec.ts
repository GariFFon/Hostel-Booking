import { expect, test } from "@playwright/test";

/**
 * The Content-Security-Policy must be present and must not break real pages: any blocked script, style, image, font, frame or
 * connection shows up as a console error naming the policy. (Run against a production build: `pnpm build && pnpm start`.)
 */
const PAGES = ["/", "/search?city=Goa", "/login", "/register"];

test("every response carries the security headers", async ({ request }) => {
  const res = await request.get("/");
  const csp = res.headers()["content-security-policy"] ?? "";
  for (const directive of ["default-src 'self'", "frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'"]) {
    expect(csp, directive).toContain(directive);
  }
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
  expect(res.headers()["x-frame-options"]).toBe("DENY");
  expect(res.headers()["referrer-policy"]).toBeTruthy();
  expect(res.headers()["cross-origin-opener-policy"]).toBe("same-origin");
  expect(res.headers()["x-powered-by"]).toBeUndefined();
});

for (const path of PAGES) {
  test(`no CSP violations on ${path}`, async ({ page }) => {
    const violations: string[] = [];
    page.on("console", (m) => {
      if (/content security policy|refused to (load|execute|apply|connect|frame)/i.test(m.text())) violations.push(m.text());
    });
    page.on("pageerror", (e) => violations.push(`pageerror: ${e.message}`));
    // A request that fails outright (e.g. wrongly upgraded to https, or blocked) is as bad as a logged violation.
    page.on("requestfailed", (r) => {
      if (r.failure()?.errorText !== "net::ERR_ABORTED") violations.push(`request failed: ${r.url()} ${r.failure()?.errorText}`);
    });
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    expect(violations, violations.join("\n")).toEqual([]);
  });
}

test("a property page with its map and photos loads under the policy", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (m) => {
    if (/content security policy|refused to (load|execute|apply|connect|frame)/i.test(m.text())) violations.push(m.text());
  });
  await page.goto("/search?city=Goa");
  await page.getByRole("link", { name: /Palolem Beach Nomads/ }).first().click();
  await page.waitForLoadState("networkidle");
  await expect(page.locator("h1").first()).toBeVisible();
  expect(violations, violations.join("\n")).toEqual([]);
});
