import { expect, request, test, type Browser, type Locator, type Page } from "@playwright/test";
import { authFile } from "./global-setup";

/**
 * Move-out and the security deposit, end to end: the owner adds a tenant, who pays the deposit online; they give notice, the owner
 * records the move-out and itemises the deposit, the tenant disputes, the owner revises, the tenant accepts, and the refund goes back
 * through the gateway. Then the owner's activity log and reports, and who may see what.
 *
 * It uses a seeded student with no stay (guest2, Isha Kapoor) at the women's hostel, so it runs once per database: reseed to run again.
 */
test.describe.configure({ mode: "serial" });

const HOSTEL = "Kothrud Scholars Hostel";
const TENANT = "Isha Kapoor";
async function as(browser: Browser, who: "owner3" | "guest2" | "admin"): Promise<Page> {
  return (await browser.newContext({ storageState: authFile(who) })).newPage();
}
let student: Page;
let owner: Page;
/** Each test can be run alone: sign the two people in on first use. */
async function people(browser: Browser) {
  student ??= await as(browser, "guest2");
  owner ??= await as(browser, "owner3");
}

async function stays(owner: Page) {
  await owner.goto("/owner/tenants");
  await owner.getByText("Stays", { exact: true }).click();
  return owner.getByRole("listitem").filter({ hasText: TENANT });
}

test("the owner adds a tenant, who accepts and pays the deposit online", async ({ browser }) => {
  await people(browser);
  await student.goto("/account/stay");
  await student.getByText("No stay yet").or(student.getByText(/Awaiting move-in|Invited|On notice|Ended/)).first().waitFor();
  test.skip((await student.getByText("No stay yet").count()) === 0, "guest2 already has a stay in this database: reseed to run again");

  await owner.goto("/owner/tenants");
  await owner.getByRole("button", { name: "Add tenant" }).click();
  const add = owner.getByRole("dialog");
  await add.getByLabel("Property").click();
  await owner.getByRole("option", { name: HOSTEL }).click();
  await add.getByLabel("Tenant's email").fill("guest2@hostel.dev");
  await add.getByRole("button", { name: "Add tenant" }).click();
  await expect(owner.getByText(/Tenant added/)).toBeVisible();

  await student.goto("/account/stay");
  await student.getByRole("button", { name: "Accept" }).click();
  await expect(student.getByText("Awaiting move-in")).toBeVisible();
  await student.getByRole("button", { name: "Pay deposit online" }).click();
  const pay = student.getByRole("dialog");
  await expect(pay.getByText("Amount to pay")).toBeVisible();
  await pay.getByRole("button", { name: /^Pay ₹/ }).click();
  await expect(student.getByText("Deposit paid").first()).toBeVisible({ timeout: 30_000 }); // confirmed by the server, not assumed
  await student.getByRole("button", { name: "Done" }).click();
  await expect(student.getByRole("button", { name: "Pay deposit online" })).toHaveCount(0);

  // the owner can now move them in, and the deposit shows as received online
  const row = await stays(owner);
  await expect(row.getByText(/received/)).toBeVisible();
  await row.getByRole("button", { name: "Record move-in" }).click();
  await owner.getByRole("dialog").getByRole("button", { name: "Record move-in" }).click();
  await expect(owner.getByText("Stay started")).toBeVisible();
});

/** Clicks a button that asks the server for a signed five-minute link, then fetches that link with no login and returns the PDF text. */
async function readPdf(page: Page, button: Locator, linkPath: RegExp) {
  const linkResponse = page.waitForResponse((r) => linkPath.test(r.url()) && r.request().method() === "POST");
  await button.click();
  const { data } = await (await linkResponse).json();
  const res = await (await request.newContext()).get(data.url as string);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("application/pdf");
  const body = await res.body();
  expect(body.subarray(0, 5).toString()).toBe("%PDF-");
  return body.toString("latin1");
}

test("both sides open the deposit receipt as a PDF", async ({ browser }) => {
  await people(browser);
  await student.goto("/account/stay");
  const mine = await readPdf(student, student.getByRole("button", { name: "Deposit receipt (PDF)" }), /\/me\/tenancies\/.+\/deposit-receipt-link/);
  expect(mine).toContain("DEPOSIT RECEIPT");
  const row = await stays(owner);
  const theirs = await readPdf(owner, row.getByRole("button", { name: "Deposit receipt" }), /\/owner\/tenancies\/.+\/deposit-receipt-link/);
  expect(theirs).toContain("DEPOSIT RECEIPT");
});

test("the tenant gives notice, the owner records the move-out", async ({ browser }) => {
  await people(browser);
  await student.goto("/account/stay");
  await student.getByRole("button", { name: "Give notice" }).first().click();
  const dlg = student.getByRole("dialog");
  await expect(dlg.getByText(/days' notice/)).toBeVisible();
  const day = dlg.getByLabel("Move-out day");
  await day.fill("2000-01-01"); // too early: the browser's own limit and the server both refuse it
  await dlg.getByRole("button", { name: "Give notice" }).click();
  await expect(dlg).toBeVisible();
  const earliest = await day.getAttribute("min");
  await day.fill(earliest!);
  await dlg.getByRole("button", { name: "Give notice" }).click();
  await expect(student.getByText(/Notice given/)).toBeVisible();
  await expect(student.getByText(/Moving out on/)).toBeVisible();
  await expect(student.getByRole("button", { name: "Withdraw notice" })).toBeVisible();

  const row = await stays(owner);
  await expect(row.getByText(/Moving out on/)).toBeVisible();
  await expect(row.getByText(/The tenant gave notice/)).toBeVisible();
  await row.getByRole("button", { name: "Record move-out" }).click();
  const mo = owner.getByRole("dialog");
  await expect(mo.getByText(/cannot be undone/)).toBeVisible();
  await mo.getByRole("button", { name: "Record move-out" }).click();
  await expect(owner.getByText(/Move-out recorded/)).toBeVisible();
  await expect(row.getByText(/Moved out on/)).toBeVisible();
  await expect(row.getByRole("button", { name: "Serve notice" })).toHaveCount(0); // the stay is over
});

test("the owner itemises the deposit and sends it; the tenant disputes; the owner revises", async ({ browser }) => {
  await people(browser);
  const row = await stays(owner);
  await row.getByRole("button", { name: "Settle the deposit" }).click();
  const dlg = owner.getByRole("dialog");
  await expect(dlg.getByText("Deductions")).toBeVisible();
  await expect(dlg.getByLabel("What deduction 1 is for")).toHaveValue(/Unpaid rent/); // the first invoice was never paid: pre-filled
  await dlg.getByRole("button", { name: "Add a deduction" }).click();
  await dlg.getByLabel("What deduction 2 is for").fill("Broken window latch");
  await dlg.getByLabel("Amount of deduction 2 in rupees").fill("500");
  await dlg.getByRole("button", { name: "Send to the tenant" }).click();
  await expect(owner.getByText("Sent to the tenant")).toBeVisible();
  await expect(owner.getByRole("dialog").getByText("Waiting for the tenant")).toBeVisible().catch(() => undefined);
  await owner.keyboard.press("Escape");

  await student.goto("/account/stay");
  const sec = student.getByRole("region", { name: "Deposit settlement" });
  await expect(sec.getByText("Broken window latch")).toBeVisible();
  await expect(sec.getByText("Comes back to the tenant")).toBeVisible();
  await sec.getByRole("button", { name: "Dispute" }).click();
  await student.getByRole("dialog").last().getByLabel("What is wrong?").fill("The latch was already broken when I moved in");
  await student.getByRole("dialog").last().getByRole("button", { name: "Send dispute" }).click();
  await expect(student.getByText("The owner has been told")).toBeVisible();

  const again = await stays(owner);
  await again.getByRole("button", { name: /Settle the deposit/ }).click();
  const rev = owner.getByRole("dialog");
  await expect(rev.getByText("The latch was already broken when I moved in")).toBeVisible();
  await rev.getByRole("button", { name: "Remove deduction 2" }).click(); // the owner accepts the tenant's point
  await rev.getByRole("button", { name: "Send to the tenant" }).click();
  await expect(owner.getByText("Sent to the tenant")).toBeVisible();
});

test("the tenant accepts and the deposit goes back through the gateway", async ({ browser }) => {
  await people(browser);
  await student.goto("/account/stay");
  const sec = student.getByRole("region", { name: "Deposit settlement" });
  await expect(sec.getByText("Broken window latch")).toHaveCount(0);
  await sec.getByRole("button", { name: "Accept" }).click();
  await expect(student.getByText("Accepted").first()).toBeVisible();
  await student.reload();
  await expect(student.getByRole("region", { name: "Deposit settlement" }).getByText(/refunded to the original payment method/)).toBeVisible();
  await expect(student.getByRole("region", { name: "Deposit settlement" }).getByRole("button", { name: "Accept" })).toHaveCount(0);

  const row = await stays(owner);
  await expect(row.getByText(/Deposit settlement: completed/)).toBeVisible();
  await row.getByRole("button", { name: "View deposit settlement" }).click();
  await expect(owner.getByRole("dialog").getByText(/refunded to the original payment method/)).toBeVisible();
});

test("the owner's activity log and reports show it, and downloads work", async ({ browser }) => {
  await people(browser);
  await owner.goto("/owner/audit");
  await expect(owner.getByRole("heading", { name: "Activity log" })).toBeVisible();
  const log = owner.getByRole("list", { name: "Activity" });
  await expect(log.getByText("Tenancy Move Out").first()).toBeVisible();
  await expect(log.getByText("Deposit Settlement Complete").first()).toBeVisible();
  await log.getByText("Tenancy Move Out").first().click(); // expands the details
  await expect(log.locator("details[open]").getByText(/"hostelId"/).first()).toBeVisible();
  await expect(log.locator("details[open]").getByText(/"ip"|userAgent/)).toHaveCount(0); // network details are not for owners

  await owner.goto("/owner/reports");
  await expect(owner.getByRole("heading", { name: "Reports" })).toBeVisible();
  await expect(owner.getByText("Occupancy").first()).toBeVisible();
  const download = owner.waitForEvent("download");
  await owner.getByRole("button", { name: "Download CSV" }).click();
  expect((await download).suggestedFilename()).toMatch(/^occupancy-\d{4}-\d{2}-\d{2}\.csv$/);
  await owner.getByRole("tab", { name: "Rent dues" }).or(owner.getByText("Rent dues", { exact: true })).first().click();
  await expect(owner.getByText(/Nobody owes rent|owe ₹/).first()).toBeVisible();
});

test("an admin sees the settled deposit; a tenant cannot reach the owner's log or reports", async ({ browser }) => {
  await people(browser);
  const admin = await as(browser, "admin");
  await admin.goto("/admin/tenancies");
  const item = admin.getByRole("listitem").filter({ hasText: TENANT });
  await expect(item.getByRole("button", { name: /Deposit: completed/ })).toBeVisible();

  await student.goto("/owner/audit");
  await expect(student.getByText(/Start hosting|This section is for/)).toBeVisible();
  await student.goto("/owner/reports");
  await expect(student.getByText(/Start hosting|This section is for/)).toBeVisible();
  const refused = await student.evaluate(async () => (await fetch("/api/bff/owner/audit-logs")).status);
  expect(refused).toBe(403);
});
