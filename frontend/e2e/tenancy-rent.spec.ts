import { expect, test, type Browser, type Page } from "@playwright/test";
import { authFile } from "./global-setup";
import { inDays } from "./helpers";

/**
 * The long-term lifecycle, end to end through the real website and API: find a PG by date, ask for a bed, get approved, pay the
 * deposit, move in, pay the first rent online; then add a second tenant by email, have them accept, and record their rent as cash.
 *
 * It consumes two seeded students (guest5, guest4): a person can only live in one place, so it runs once per database. Re-running
 * against the same data is skipped with a message: reseed (`pnpm db:reset && pnpm db:seed`) to run it again.
 */
test.describe.configure({ mode: "serial" });

const PG = "Koregaon Park Students PG"; // men only, approval required, owner3
const HOSTEL = "Kothrud Scholars Hostel"; // women only, owner3
const PG_SLUG = "koregaon-park-students-pg-pune";

async function as(browser: Browser, who: "owner3" | "owner1" | "guest5" | "guest4"): Promise<Page> {
  return (await browser.newContext({ storageState: authFile(who) })).newPage();
}

test("a dated search finds long-term places by free beds, not by nightly availability", async ({ page }) => {
  await page.goto(`/search?city=Pune&propertyType=PG&checkIn=${inDays(30)}&checkOut=${inDays(33)}`);
  await expect(page.getByRole("link", { name: new RegExp(PG) }).first()).toBeVisible();
  await page.goto(`/search?city=Pune&propertyType=HOSTEL&checkIn=${inDays(30)}&checkOut=${inDays(33)}`);
  await expect(page.getByRole("link", { name: new RegExp(HOSTEL) }).first()).toBeVisible();
});

test("a PG shows monthly rent and terms instead of a nightly booking form", async ({ browser }) => {
  const student = await as(browser, "guest5");
  await student.goto(`/hostels/${PG_SLUG}`);
  await expect(student.getByRole("heading", { name: "Beds and rooms" })).toBeVisible();
  await expect(student.getByText(/Deposit:/).first()).toBeVisible();
  await expect(student.getByText(/Notice period:/).first()).toBeVisible();
  await expect(student.getByText("/ month").first()).toBeVisible();
  await expect(student.getByText(/Check-in/)).toBeVisible(); // house details still show; no Reserve/date picker
  await expect(student.getByRole("button", { name: /Reserve/ })).toHaveCount(0);
});

test("request a bed, get approved, pay the deposit, move in, and pay the first rent online", async ({ browser }) => {
  const student = await as(browser, "guest5");
  const owner = await as(browser, "owner3");

  // already ran against this database?
  await student.goto("/account/stay");
  await expect(student.getByRole("heading", { name: "My stay" })).toBeVisible();
  await student.getByText("No stay yet").or(student.getByText(/Awaiting move-in|Open requests|Invited/)).or(student.getByRole("heading", { name: "Rent" })).first().waitFor(); // wait for the page's data, not just its title
  const alreadyRan = (await student.getByText("No stay yet").count()) === 0;
  test.skip(alreadyRan, "this database already has the run's data: reseed to run it again");

  // 1. the student asks for a bed
  await student.goto(`/hostels/${PG_SLUG}`);
  await student.locator("button:visible", { hasText: "Request a bed" }).first().click();
  const apply = student.getByRole("dialog");
  await apply.getByLabel("Your gender").click();
  await student.getByRole("option", { name: "Male", exact: true }).click();
  await apply.getByLabel("Emergency contact name").fill("Rita Wilson");
  await apply.getByLabel("Emergency contact phone").fill("+919876500011");
  await apply.getByRole("button", { name: "Send request" }).click();
  await expect(student.getByText(/Request sent/).first()).toBeVisible();

  // 2. the owner approves it
  await owner.goto("/owner/tenants");
  await expect(owner.getByText("Sam Wilson")).toBeVisible();
  await owner.getByRole("button", { name: "Approve" }).first().click();
  await owner.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
  await expect(owner.getByText(/Approved\. A bed is reserved/)).toBeVisible();

  // 3. the student sees the reserved bed
  await student.goto("/account/stay");
  await expect(student.getByText("Awaiting move-in")).toBeVisible();
  await expect(student.getByText(/Pay the deposit to the owner/)).toBeVisible();

  // 4. move-in needs the deposit first
  await owner.getByText("Stays", { exact: true }).click();
  await owner.getByRole("button", { name: "Record move-in" }).click();
  await owner.getByRole("dialog").getByRole("button", { name: "Record move-in" }).click();
  await expect(owner.getByText(/Record the deposit before move-in/).first()).toBeVisible(); // refused until the deposit is recorded
  await owner.keyboard.press("Escape");
  await owner.getByRole("button", { name: "Record deposit" }).click();
  await owner.getByRole("dialog").getByRole("button", { name: "Record", exact: true }).click();
  await expect(owner.getByText("Deposit recorded")).toBeVisible();
  await owner.getByRole("button", { name: "Record move-in" }).click();
  await owner.getByRole("dialog").getByRole("button", { name: "Record move-in" }).click();
  await expect(owner.getByText("Stay started")).toBeVisible();

  // 5. the first rent invoice exists, and the student pays it online
  await student.goto("/account/stay");
  await expect(student.getByRole("heading", { name: "Rent" })).toBeVisible();
  await student.getByRole("button", { name: /^Pay ₹/ }).first().click();
  const pay = student.getByRole("dialog");
  await expect(pay.getByText("Amount to pay")).toBeVisible();
  await pay.getByRole("button", { name: /^Pay ₹/ }).click();
  await expect(student.getByText("Rent paid").first()).toBeVisible({ timeout: 30_000 }); // confirmed by the server, not assumed
  await student.getByRole("button", { name: "Done" }).click();

  // 6. the owner sees it collected online
  await owner.goto("/owner/rent");
  await expect(owner.getByText("Collected")).toBeVisible();
  await owner.getByText("Paid", { exact: true }).click();
  await owner.getByRole("button", { name: /Sam Wilson/ }).first().click();
  await expect(owner.getByRole("dialog").getByText(/Online/)).toBeVisible();
  await expect(owner.getByRole("dialog").getByText(/RCPT-/)).toBeVisible();
  await expect(owner.getByRole("dialog").getByRole("button", { name: "Record payment" })).toHaveCount(0); // nothing left to record
});

test("add a tenant by email, they accept, and the owner records their rent as cash", async ({ browser }) => {
  const student = await as(browser, "guest4");
  const owner = await as(browser, "owner3");

  await student.goto("/account/stay");
  await expect(student.getByRole("heading", { name: "My stay" })).toBeVisible();
  await student.getByText("No stay yet").or(student.getByText(/Awaiting move-in|Open requests|Invited/)).or(student.getByRole("heading", { name: "Rent" })).first().waitFor();
  test.skip((await student.getByText("No stay yet").count()) === 0, "this database already has the run's data: reseed to run it again");

  // the owner adds Meera to the women's hostel, with no deposit
  await owner.goto("/owner/tenants");
  await owner.getByRole("button", { name: "Add tenant" }).click();
  const add = owner.getByRole("dialog");
  await add.getByLabel("Property").click();
  await owner.getByRole("option", { name: HOSTEL }).click();
  await add.getByLabel("Tenant's email").fill("guest4@hostel.dev");
  await add.getByLabel("Deposit (₹)").fill("0");
  await add.getByRole("button", { name: "Add tenant" }).click();
  await expect(owner.getByText(/Tenant added/)).toBeVisible();

  // she sees the invitation and accepts it
  await student.goto("/account/stay");
  await expect(student.getByText("Invited")).toBeVisible();
  await student.getByRole("button", { name: "Accept" }).click();
  await expect(student.getByText("Awaiting move-in")).toBeVisible();

  // move-in (no deposit to record) issues the first invoice
  await owner.goto("/owner/tenants");
  await owner.getByText("Stays", { exact: true }).click();
  const row = owner.getByRole("listitem").filter({ hasText: "Meera Iyer" });
  await row.getByRole("button", { name: "Record move-in" }).click();
  await owner.getByRole("dialog").getByRole("button", { name: "Record move-in" }).click();
  await expect(owner.getByText("Stay started")).toBeVisible();

  // the owner records the cash she handed over
  await owner.goto("/owner/rent");
  await owner.getByText("Due", { exact: true }).click();
  await owner.getByRole("button", { name: /Meera Iyer/ }).first().click();
  await owner.getByRole("button", { name: "Record payment" }).click();
  await owner.getByRole("dialog").last().getByRole("button", { name: "Record", exact: true }).click();
  await expect(owner.getByText("Payment recorded")).toBeVisible();

  // she sees the receipt
  await student.goto("/account/stay");
  await student.getByText("Details and receipts").first().click();
  await expect(student.getByText(/RCPT-/).first()).toBeVisible();
  await expect(student.getByText("Paid", { exact: true }).first()).toBeVisible();
});

test("a student cannot open the owner's rent and tenant pages, and an owner sees nothing of another owner's tenants", async ({ browser }) => {
  const student = await as(browser, "guest5");
  await student.goto("/owner/rent");
  await expect(student.getByText(/Start hosting|This section is for/)).toBeVisible();
  await student.goto("/owner/tenants");
  await expect(student.getByText(/Start hosting|This section is for/)).toBeVisible();

  const other = await as(browser, "owner1"); // owns other properties
  await other.goto("/owner/tenants");
  await other.getByText("Stays", { exact: true }).click();
  await expect(other.getByText("Sam Wilson")).toHaveCount(0);
  await expect(other.getByText("Meera Iyer")).toHaveCount(0);
});
