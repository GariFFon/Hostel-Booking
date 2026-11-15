import { expect, test, type Browser, type Page } from "@playwright/test";
import { authFile } from "./global-setup";

/**
 * PDF receipts, refunds of online rent, and the admin rent screen, through the real website and API. It continues the story of
 * tenancy-rent.spec.ts (Sam Wilson paid his first rent online at Koregaon Park Students PG), so run that first on a fresh database.
 */
test.describe.configure({ mode: "serial" });

const TENANT = "Sam Wilson";
async function as(browser: Browser, who: "owner3" | "guest5" | "admin"): Promise<Page> {
  return (await browser.newContext({ storageState: authFile(who) })).newPage();
}

async function openPaidInvoice(owner: Page) {
  await owner.goto("/owner/rent");
  await owner.getByRole("tab", { name: "All" }).or(owner.getByText("All", { exact: true })).first().click(); // paid, or partly refunded since
  await owner.getByRole("button", { name: new RegExp(TENANT) }).first().click();
  return owner.getByRole("dialog");
}

test("the owner opens a PDF receipt for an online payment", async ({ browser }) => {
  const owner = await as(browser, "owner3");
  const dlg = await openPaidInvoice(owner);
  await expect(dlg.getByText(/RCPT-/)).toBeVisible();
  // The click asks the server for a five-minute link, then points a new tab at it. Read the link itself (whether the browser shows
  // the PDF or downloads it is the browser's business), and fetch it with no login: the signed token is the credential.
  const linkResponse = owner.waitForResponse((r) => /\/rent-payments\/.+\/receipt-link/.test(r.url()) && r.request().method() === "POST");
  await dlg.getByRole("button", { name: "Receipt (PDF)" }).first().click();
  const { data } = await (await linkResponse).json();
  const url: string = data.url;
  expect(url).toMatch(/\/api\/v1\/receipts\//);
  const res = await (await import("@playwright/test")).request.newContext().then((c) => c.get(url));
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("application/pdf");
  const body = await res.body();
  expect(body.subarray(0, 5).toString()).toBe("%PDF-");
  expect(body.toString("latin1")).toContain("RENT RECEIPT");
  const anon = await (await import("@playwright/test")).request.newContext();
  expect((await anon.get(url.slice(0, -4) + "AAAA")).status()).toBe(404); // a tampered link is refused
});

test("the owner opens the invoice as a PDF", async ({ browser }) => {
  const owner = await as(browser, "owner3");
  const dlg = await openPaidInvoice(owner);
  const linkResponse = owner.waitForResponse((r) => /\/rent-invoices\/.+\/pdf-link/.test(r.url()) && r.request().method() === "POST");
  await dlg.getByRole("button", { name: "Invoice (PDF)" }).click();
  const { data } = await (await linkResponse).json();
  const res = await (await import("@playwright/test")).request.newContext().then((c) => c.get(data.url as string));
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("application/pdf");
  const body = (await res.body()).toString("latin1");
  expect(body.slice(0, 5)).toBe("%PDF-");
  expect(body).toContain("INV-");
});

test("the owner refunds part of it; the invoice owes it again and the tenant sees it", async ({ browser }) => {
  const owner = await as(browser, "owner3");
  const dlg = await openPaidInvoice(owner);
  await dlg.getByRole("button", { name: "Refund", exact: true }).click();
  const refund = owner.getByRole("dialog").last();
  await expect(refund.getByText("Refund this payment")).toBeVisible();
  await refund.getByLabel("Amount (₹)").fill("100000"); // far more than was paid
  await refund.getByLabel("Reason").fill("Paid twice by mistake");
  await refund.getByRole("button", { name: "Refund", exact: true }).click();
  await expect(refund.getByText(/at most|At most/i).first()).toBeVisible(); // refused with the limit in words
  await refund.getByLabel("Amount (₹)").fill("1000");
  await refund.getByRole("button", { name: "Refund", exact: true }).click();
  await expect(owner.getByText("Refund started")).toBeVisible();
  await expect(owner.getByRole("dialog").getByText(/Refunded ₹1,000(\.00)?: Paid twice by mistake/).first()).toBeVisible();
  await expect(owner.getByRole("dialog").getByText(/Partially Paid|Part paid/)).toBeVisible();

  const student = await as(browser, "guest5");
  await student.goto("/account/stay");
  await student.getByText("Details and receipts").first().click();
  await expect(student.getByText(/Refunded ₹1,000(\.00)?: Paid twice by mistake/).first()).toBeVisible();
  await expect(student.getByRole("button", { name: "Receipt (PDF)" }).first()).toBeVisible();
});

test("an admin sees rent across the platform, opens the invoice and refunds the rest", async ({ browser }) => {
  const admin = await as(browser, "admin");
  await admin.goto("/admin/rent");
  await expect(admin.getByRole("heading", { name: "Rent" })).toBeVisible();
  for (const label of ["Billed", "Collected", "Still owed", "Overdue"]) await expect(admin.getByText(label, { exact: true }).first()).toBeVisible();
  await expect(admin.getByRole("table", { name: /Rent by property/ }).or(admin.getByRole("region", { name: "By property" })).first()).toBeVisible();
  await admin.getByRole("tab", { name: "All" }).or(admin.getByText("All", { exact: true })).first().click();
  await admin.getByRole("button", { name: new RegExp(TENANT) }).first().click();
  const dlg = admin.getByRole("dialog");
  await expect(dlg.getByText(/Refunded ₹1,000/).first()).toBeVisible();
  await dlg.getByRole("button", { name: "Refund", exact: true }).click();
  const refund = admin.getByRole("dialog").last();
  await refund.getByLabel("Reason").fill("Support: tenant asked for the rest back");
  await refund.getByRole("button", { name: "Refund", exact: true }).click();
  await expect(admin.getByText("Refund started")).toBeVisible();
  await expect(admin.getByRole("dialog").getByText(/Support: tenant asked for the rest back/).first()).toBeVisible();
  await expect(admin.getByRole("dialog").getByRole("button", { name: "Refund", exact: true })).toHaveCount(0); // nothing left to refund
});

test("a tenant cannot open the admin rent screen, and cannot refund or reach another tenant's receipt", async ({ browser }) => {
  const student = await as(browser, "guest5");
  await student.goto("/admin/rent");
  await expect(student.getByText("You don't have access to this area")).toBeVisible();
  // from inside the page (the site's own cookies and origin): refunding is refused, and another payment's receipt looks missing
  const refused = await student.evaluate(async () => {
    const r = await fetch("/api/bff/owner/rent-payments/01a1df4d-2583-7141-9882-3b725fcea871/refund", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ amountPaise: 100, reason: "Should not work" }) });
    const l = await fetch("/api/bff/me/rent-payments/01a1df4d-2583-7141-9882-3b725fcea871/receipt-link", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    return [r.status, l.status];
  });
  expect(refused).toEqual([403, 404]);
});
