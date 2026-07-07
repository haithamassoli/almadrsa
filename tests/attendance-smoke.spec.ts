import { expect, test } from "@playwright/test";
import {
  bootstrap,
  DEMO_CLASS_NAME,
  newPhoneContext,
  staffLogin,
  studentLogin,
  TEACHER_EMAIL,
  TEACHER_PASSWORD,
  type BootstrapResult,
} from "./helpers";

let boot: BootstrapResult;

test.beforeAll(() => {
  boot = bootstrap();
});

test("attendance: teacher marks the student absent → parent sees it in the portal", async ({
  browser,
}) => {
  // ——— Teacher: open today's first demo-class lesson and record attendance ———
  const teacherContext = await newPhoneContext(browser);
  const teacherPage = await teacherContext.newPage();
  await staffLogin(teacherPage, TEACHER_EMAIL, TEACHER_PASSWORD);

  // /teacher materializes today's timetable lessons on mount; open the first
  // lesson card of the demo class (the bootstrap student's class).
  await teacherPage
    .getByRole("link", { name: /فتح الحصة/ })
    .filter({ hasText: DEMO_CLASS_NAME })
    .first()
    .click();
  await teacherPage.waitForURL(/\/teacher\/lessons\//);

  const saveButton = teacherPage.getByRole("button", { name: "حفظ الحضور" });
  await teacherPage
    .getByRole("button", { name: "تحديد الجميع حاضرًا" })
    .click();

  // Flip the bootstrap student to absent (row located by student name).
  const studentGroup = teacherPage.getByRole("group", {
    name: `حالة حضور ${boot.studentName}`,
  });
  await studentGroup.getByRole("button", { name: "غائب" }).click();
  await expect(
    studentGroup.getByRole("button", { name: "غائب" }),
  ).toHaveAttribute("aria-pressed", "true");

  // Save when dirty. On re-runs the server may already hold exactly this
  // state (everyone present, bootstrap student absent) — then there is
  // nothing to save and the button is already disabled.
  if (await saveButton.isEnabled()) {
    await saveButton.click();
    await expect(
      teacherPage.getByText("تم حفظ الحضور").first(),
    ).toBeVisible();
  }
  await expect(saveButton).toBeDisabled();

  // ——— Student/parent: the absence shows up in the portal history ———
  const studentContext = await newPhoneContext(browser);
  const studentPage = await studentContext.newPage();
  await studentLogin(studentPage, boot.code);

  await studentPage.getByRole("link", { name: "الحضور", exact: true }).click();
  await studentPage.waitForURL(/\/portal\/attendance/);

  // Today's row carries the absent badge. formatDate renders Latin digits
  // with RTL marks around the separators (e.g. "07‏/07‏/2026").
  const today = new Date();
  const dd = String(today.getDate()).padStart(2, "0");
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const todayRe = new RegExp(
    `${dd}\\u200f?/${mm}\\u200f?/${today.getFullYear()}`,
  );
  const absentTodayRow = studentPage
    .getByRole("row")
    .filter({ hasText: todayRe })
    .filter({ has: studentPage.getByText("غائب", { exact: true }) });
  await expect(absentTodayRow.first()).toBeVisible();

  // The absent totals tile counts at least our one absence (never assert an
  // exact global count — the dev data is shared).
  const absentTile = studentPage
    .locator(".grid.grid-cols-3 > div")
    .filter({ hasText: "غائب" });
  await expect(absentTile).toBeVisible();
  const absentTotal = Number(await absentTile.locator("span").nth(1).innerText());
  expect(absentTotal).toBeGreaterThanOrEqual(1);

  await studentContext.close();
  await teacherContext.close();
});
