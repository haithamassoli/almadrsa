import { expect, test } from "@playwright/test";
import {
  bootstrap,
  bootstrapSibling,
  newPhoneContext,
  studentLogin,
  type BootstrapResult,
} from "./helpers";

let childA: BootstrapResult;
let childB: BootstrapResult;

test.beforeAll(() => {
  // Each bootstrap rotates only its own student's code, so seeding both before
  // any login gives us two distinct children we can log in on one device.
  childA = bootstrap();
  childB = bootstrapSibling();
});

test("family switch: two children accumulate on one device, switch without re-login, sign-out promotes the sibling", async ({
  browser,
}) => {
  expect(childA.studentName).not.toBe(childB.studentName);

  const context = await newPhoneContext(browser);
  const page = await context.newPage();
  const header = page.locator("header");
  const nameA = new RegExp(childA.studentName);
  const nameB = new RegExp(childB.studentName);

  // ——— Log in child A; the portal header shows A ———
  await studentLogin(page, childA.code);
  await expect(header.getByText(childA.studentName)).toBeVisible();

  // ——— Add child B via the switcher → land on /code → log in ———
  await header.getByRole("button", { name: nameA }).click();
  await page.getByRole("menuitem", { name: "إضافة طالب آخر" }).click();
  await page.waitForURL(/\/code(\/|$)/);
  await studentLogin(page, childB.code);
  await expect(header.getByText(childB.studentName)).toBeVisible();

  // ——— Both children are listed; switch back to A WITHOUT visiting /code ———
  await header.getByRole("button", { name: nameB }).click();
  await expect(page.getByRole("menuitem", { name: nameA })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: nameB })).toBeVisible();
  await page.getByRole("menuitem", { name: nameA }).click();
  await expect(header.getByText(childA.studentName)).toBeVisible();
  expect(page.url()).toMatch(/\/portal(\/|$)/);

  // ——— Sign out removes only A and promotes B (still in the portal) ———
  await header.getByRole("button", { name: "تسجيل الخروج" }).click();
  await expect(header.getByText(childB.studentName)).toBeVisible();
  expect(page.url()).toMatch(/\/portal(\/|$)/);

  // ——— Sign out the last account → back to /code ———
  await header.getByRole("button", { name: "تسجيل الخروج" }).click();
  await page.waitForURL(/\/code(\/|$)/);

  await context.close();
});
