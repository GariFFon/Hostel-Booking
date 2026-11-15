import { expect, test, type Browser, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { authFile } from "./global-setup";
import { inDays } from "./helpers";

/**
 * Staff and complaints, end to end through the real website and API: the owner invites a plumber by email, the plumber accepts,
 * a tenant files a complaint that is auto-assigned, the plumber fixes it, the tenant rates it, and the owner, admin and an
 * unrelated tenant each see exactly what they should.
 *
 * It needs: (1) a tenant already living at the PG (run tenancy-rent.spec.ts first: it moves guest5 in), (2) E2E_DATABASE_URL (a plain
 * postgres URL for the test database) and `psql`: the invitation secret is only ever sent by email and stored hashed, so the test
 * swaps the pending invitation's hash for one it knows, exactly as if it had read the link from the email. It turns guest3 into
 * staff, so it runs once per database: reseed to run it again.
 */
test.describe.configure({ mode: "serial" });

const PG = "Koregaon Park Students PG";
const TITLE = `Tap is leaking ${Date.now().toString(36)}`;
const DB = process.env.E2E_DATABASE_URL;

async function as(browser: Browser, who: "owner3" | "owner1" | "guest5" | "guest4" | "guest3" | "admin"): Promise<Page> {
  return (await browser.newContext({ storageState: authFile(who) })).newPage();
}

/** Stands in for "open the link in the email": gives the pending invitation a token we know, and returns it. */
function readInviteLink(email: string): string {
  const token = `e2e-invite-${Date.now().toString(36)}-${"x".repeat(24)}`;
  const hash = createHash("sha256").update(token).digest("hex");
  execFileSync("psql", [DB!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `UPDATE staff_invites SET token_hash = '${hash}' WHERE email = '${email}' AND accepted_at IS NULL AND cancelled_at IS NULL`]);
  return token;
}

test.beforeAll(() => { test.skip(!DB, "set E2E_DATABASE_URL to the test database (plain postgres URL)"); });

let plumber: Page;

test("the owner invites a plumber and the plumber accepts the invitation", async ({ browser }) => {
  const owner = await as(browser, "owner3");
  plumber = await as(browser, "guest3");

  await plumber.goto("/staff");
  await expect(plumber.getByText(/This area is for maintenance staff|My jobs/).first()).toBeVisible();
  test.skip((await plumber.getByRole("heading", { name: "My jobs" }).count()) > 0 && (await plumber.getByText("This area is for maintenance staff").count()) === 0, "guest3 is already staff in this database: reseed to run again");

  await owner.goto("/owner/staff");
  await expect(owner.getByRole("heading", { name: "Staff" })).toBeVisible();
  await owner.getByRole("button", { name: "Invite staff" }).first().click();
  const dlg = owner.getByRole("dialog");
  await dlg.getByLabel("Email").fill("guest3@hostel.dev");
  await dlg.getByLabel("Trade").click();
  await owner.getByRole("option", { name: "Plumber" }).click();
  await dlg.getByRole("checkbox", { name: PG }).check();
  await dlg.getByRole("button", { name: "Send invitation" }).click();
  await expect(owner.getByText("Invitation sent")).toBeVisible();
  await expect(owner.getByText("guest3@hostel.dev")).toBeVisible(); // listed as waiting to join

  // a person cannot use an invitation that was not sent to them
  const token = readInviteLink("guest3@hostel.dev");
  const stranger = await as(browser, "guest4");
  await stranger.goto(`/staff?invite=${encodeURIComponent(token)}`);
  await stranger.getByRole("button", { name: "Accept invitation" }).click();
  await expect(stranger.getByText(/Invitation not found|not found|expired/i).first()).toBeVisible();

  await plumber.goto(`/staff?invite=${encodeURIComponent(token)}`);
  await plumber.getByRole("button", { name: "Accept invitation" }).click();
  await expect(plumber.getByText(/Welcome aboard/)).toBeVisible();
  await expect(plumber.getByRole("heading", { name: "My jobs" })).toBeVisible();
  await expect(plumber.getByText(/Plumber/).first()).toBeVisible();

  await owner.goto("/owner/staff");
  await expect(owner.getByText("Plumber").first()).toBeVisible();
  await expect(owner.getByText(/Works at/).first()).toBeVisible();
});

test("a tenant files a complaint and it is assigned to the plumber automatically", async ({ browser }) => {
  const tenant = await as(browser, "guest5");
  await tenant.goto("/account/complaints");
  await expect(tenant.getByRole("heading", { name: "Complaints" })).toBeVisible();
  await tenant.getByRole("button", { name: "New complaint" }).first().click();
  const dlg = tenant.getByRole("dialog");
  await dlg.getByLabel("Short title").fill(TITLE);
  await dlg.getByLabel("What is wrong?").fill("The bathroom tap drips all night and the floor is wet.");
  await dlg.getByRole("button", { name: "Send complaint" }).click();
  await expect(tenant.getByText("Complaint sent")).toBeVisible();
  const detail = tenant.getByRole("dialog");
  await expect(detail.getByRole("heading", { name: TITLE })).toBeVisible();
  await expect(detail.getByText("Assigned", { exact: true }).first()).toBeVisible();
  await expect(detail.getByText(/\(Plumber\)/)).toBeVisible(); // auto-assigned by trade
  await expect(detail.getByText("Your free time")).toBeVisible(); // the window is mandatory: the form sent tomorrow 9am to 9pm
  await expect(detail.getByRole("button", { name: "Change my free time" })).toBeVisible();
  await expect(detail.getByRole("button", { name: /Book a visit/ })).toHaveCount(0); // tenants do not book visits
  await expect(detail.getByRole("button", { name: "Withdraw" })).toBeVisible();
  await expect(detail.getByRole("button", { name: "Rate the fix" })).toHaveCount(0); // not resolved yet
});

test("the plumber sees the job, starts it and resolves it with a note", async () => {
  await plumber.goto("/staff");
  await plumber.getByRole("button", { name: new RegExp(TITLE) }).click();
  const dlg = plumber.getByRole("dialog");
  await expect(dlg.getByRole("heading", { name: TITLE })).toBeVisible();
  await expect(dlg.getByText("Tenant is free")).toBeVisible();
  await expect(dlg.getByText("Not booked yet")).toBeVisible();

  // a visit outside the tenant's free time is refused, in words
  await dlg.getByRole("button", { name: "Book a visit" }).click();
  const visit = plumber.getByRole("dialog").last();
  await visit.getByLabel("Day").fill(inDays(6));
  await visit.getByRole("button", { name: "Book visit" }).click();
  await expect(visit.getByText(/inside the tenant.s free time/)).toBeVisible();
  // the default slot starts where the free time starts, so it is accepted
  await visit.getByLabel("Day").fill(inDays(1));
  await visit.getByRole("button", { name: "Book visit" }).click();
  await expect(plumber.getByText(/Visit booked\. The tenant has been told/)).toBeVisible();
  await expect(dlg.getByText("Visit booked", { exact: true })).toBeVisible();
  await expect(dlg.getByRole("button", { name: "Change visit time" })).toBeVisible();

  await dlg.getByRole("button", { name: "Start work" }).click();
  await expect(plumber.getByText("Started")).toBeVisible();
  await dlg.getByRole("button", { name: "Put on hold" }).click();
  await plumber.getByRole("dialog").last().getByLabel("Why?").fill("Waiting for a washer");
  await plumber.getByRole("dialog").last().getByRole("button", { name: "Put on hold" }).click();
  await expect(dlg.getByText("On hold").first()).toBeVisible();
  await dlg.getByRole("button", { name: "Resume work" }).click();
  await expect(plumber.getByText("Resumed")).toBeVisible(); // wait for the server before the next step
  await dlg.getByRole("button", { name: "Mark resolved" }).click();
  await plumber.getByRole("dialog").last().getByLabel("What was done?").fill("Replaced the washer and tightened the joint.");
  await plumber.getByRole("dialog").last().getByRole("button", { name: "Resolved" }).click();
  await expect(plumber.getByText("Marked resolved")).toBeVisible();
  await expect(dlg.getByText("Replaced the washer and tightened the joint.").first()).toBeVisible();
});

test("the owner sees it, adds a private note the tenant never sees", async ({ browser }) => {
  const owner = await as(browser, "owner3");
  await owner.goto("/owner/complaints");
  await owner.getByRole("tab", { name: "All" }).or(owner.getByText("All", { exact: true })).first().click();
  await owner.getByRole("button", { name: new RegExp(TITLE) }).click();
  const dlg = owner.getByRole("dialog");
  await expect(dlg.getByText(/Replaced the washer/).first()).toBeVisible();
  await expect(dlg.getByText("Raised by")).toBeVisible(); // the owner sees who reported it (contact hiding for staff is covered by the API tests)
  await dlg.getByLabel("Add a comment").fill("Check the other tap on the next visit.");
  await dlg.getByLabel("Visible to staff and owner only").check();
  await dlg.getByRole("button", { name: "Post", exact: true }).click();
  await expect(dlg.getByText("Staff only")).toBeVisible();
});

test("the tenant sees the fix, cannot see the private note, rates it and closes the complaint", async ({ browser }) => {
  const tenant = await as(browser, "guest5");
  await tenant.goto("/account/complaints");
  await tenant.getByRole("button", { name: new RegExp(TITLE) }).click();
  const dlg = tenant.getByRole("dialog");
  await expect(dlg.getByText("Visit booked", { exact: true })).toBeVisible(); // the tenant sees the slot staff booked
  await expect(dlg.getByText("Replaced the washer and tightened the joint.").first()).toBeVisible();
  await expect(dlg.getByText("Check the other tap")).toHaveCount(0);
  await dlg.getByRole("button", { name: "Rate the fix" }).click();
  const rate = tenant.getByRole("dialog").last();
  await rate.getByRole("radio", { name: "5 stars" }).click();
  await rate.getByRole("button", { name: "Send rating" }).click();
  await expect(tenant.getByText("Thanks for the feedback")).toBeVisible();
  await expect(dlg.getByRole("button", { name: "Rate the fix" })).toHaveCount(0); // once only
  await dlg.getByRole("button", { name: "Close it" }).click();
  await tenant.getByRole("dialog", { name: "Close this complaint?" }).locator("button[data-slot=button]", { hasText: /^Close$/ }).click();
  await expect(tenant.getByText("Complaint closed")).toBeVisible();
});

test("an admin can read it but not act on it, and a tenant at another property sees nothing of it", async ({ browser }) => {
  const admin = await as(browser, "admin");
  await admin.goto("/admin/complaints");
  await admin.getByRole("button", { name: new RegExp(TITLE) }).click();
  const dlg = admin.getByRole("dialog");
  await expect(dlg.getByRole("heading", { name: TITLE })).toBeVisible();
  await expect(dlg.getByRole("button", { name: /Mark resolved|Start work|Assign|Close it|Rate the fix/ })).toHaveCount(0);
  await expect(dlg.getByLabel("Add a comment")).toHaveCount(0);

  const other = await as(browser, "guest4");
  await other.goto("/account/complaints");
  await expect(other.getByRole("heading", { name: "Complaints" })).toBeVisible();
  await expect(other.getByText(TITLE)).toHaveCount(0);

  const stranger = await as(browser, "owner1"); // another owner: not their property
  await stranger.goto("/owner/complaints");
  await stranger.getByText("All", { exact: true }).first().click();
  await expect(stranger.getByText(TITLE)).toHaveCount(0);
});

test("the plumber cannot open the owner or admin areas", async () => {
  await plumber.goto("/owner/complaints");
  await expect(plumber.getByText(/Start hosting|This section is for/)).toBeVisible();
  await plumber.goto("/admin/staff");
  await expect(plumber.getByText("You don't have access to this area")).toBeVisible();
});
