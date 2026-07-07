import { expect, test, type Page } from "@playwright/test";
import {
  bootstrap,
  DEMO_CLASS_NAME,
  DEMO_SUBJECT_NAME,
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

/** ms → <input type="datetime-local"> value in LOCAL wall time (YYYY-MM-DDTHH:mm). */
function toLocalInputValue(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

/**
 * Playwright's .fill() does NOT sync React state for controlled
 * datetime-local inputs — set the value through the native setter and
 * dispatch input/change so React's onChange fires with the new value.
 */
async function setDatetimeLocal(
  page: Page,
  selector: string,
  value: string,
): Promise<void> {
  await page.evaluate(
    ([sel, val]) => {
      const input = document.querySelector<HTMLInputElement>(sel);
      if (!input) throw new Error(`missing input: ${sel}`);
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, val);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    },
    [selector, value] as const,
  );
}

const SCORE_FRACTION = /^\d+(?:[.,]\d+)?\/\d+(?:[.,]\d+)?$/;

test("exam full cycle on a phone: build → publish → take → submit → score lands", async ({
  browser,
}) => {
  const title = `E2E اختبار ${Date.now()}`;

  // ——— Teacher: build a draft from the question bank ———
  const teacherContext = await newPhoneContext(browser);
  const teacherPage = await teacherContext.newPage();
  await staffLogin(teacherPage, TEACHER_EMAIL, TEACHER_PASSWORD);
  await teacherPage.goto("/teacher/exams/new");

  await teacherPage.getByLabel("عنوان الاختبار").fill(title);

  await teacherPage.getByRole("combobox", { name: "الفصل" }).click();
  await teacherPage
    .getByRole("option", { name: new RegExp(DEMO_CLASS_NAME) })
    .click();
  await teacherPage.getByRole("combobox", { name: "المادة" }).click();
  await teacherPage.getByRole("option", { name: DEMO_SUBJECT_NAME }).click();

  // Window: opened 5 minutes ago, closes in 2 hours.
  await setDatetimeLocal(
    teacherPage,
    "#exam-window-start",
    toLocalInputValue(Date.now() - 5 * 60_000),
  );
  await setDatetimeLocal(
    teacherPage,
    "#exam-window-end",
    toLocalInputValue(Date.now() + 2 * 60 * 60_000),
  );

  // Pick the first two bank questions (1 mark each by default).
  const questionBoxes = teacherPage.getByRole("checkbox", {
    name: /تحديد السؤال/,
  });
  await questionBoxes.nth(0).check();
  await questionBoxes.nth(1).check();

  await teacherPage.getByRole("button", { name: "حفظ كمسودة" }).click();
  await teacherPage.waitForURL(/\/teacher\/exams\/(?!new$)[^/]+$/);
  const examUrl = teacherPage.url();
  await expect(teacherPage.getByRole("heading", { name: title })).toBeVisible();

  // Publish, confirming in the AlertDialog.
  await teacherPage.getByRole("button", { name: "نشر الاختبار" }).click();
  const publishDialog = teacherPage.getByRole("alertdialog");
  await publishDialog.getByRole("button", { name: "نشر الاختبار" }).click();
  await expect(teacherPage.getByText("منشور", { exact: true })).toBeVisible();

  // ——— Student (390×844): take the exam ———
  const studentContext = await newPhoneContext(browser);
  const studentPage = await studentContext.newPage();
  await studentLogin(studentPage, boot.code);
  await studentPage.goto("/portal/exams");

  const availableSection = studentPage
    .locator("section")
    .filter({ has: studentPage.getByRole("heading", { name: "متاح الآن" }) });
  const examCard = availableSection
    .locator("div.rounded-2xl")
    .filter({ hasText: title });
  await examCard.getByRole("link", { name: "ابدأ الاختبار" }).click();
  await studentPage.waitForURL(/\/portal\/exams\/[^/]+$/);

  // Taking screen is up once the submit bar renders.
  const submitCta = studentPage.getByRole("button", { name: "تسليم الاختبار" });
  await expect(submitCta).toBeVisible();

  // Answer the first question: first MCQ option label ("صح" for true/false).
  const firstQuestion = studentPage
    .locator("div.rounded-2xl.border.bg-card")
    .first();
  const mcqOptions = firstQuestion.locator('label:has(input[type="radio"])');
  if ((await mcqOptions.count()) > 0) {
    await mcqOptions.first().click();
  } else {
    await firstQuestion.getByRole("button", { name: "صح" }).click();
  }

  // Autosave cycle: "يُحفظ…" then the saved indicator.
  await expect(studentPage.getByText("يُحفظ…")).toBeVisible();
  await expect(studentPage.getByText("محفوظ", { exact: true })).toBeVisible();

  // Submit and confirm in the AlertDialog.
  await submitCta.click();
  const submitDialog = studentPage.getByRole("alertdialog");
  await expect(submitDialog.getByText("تسليم الاختبار؟")).toBeVisible();
  await submitDialog.getByRole("button", { name: "تسليم الاختبار" }).click();

  // Result screen: submitted label + a score fraction.
  await expect(studentPage.getByText("تم تسليم الاختبار").first()).toBeVisible();
  await expect(studentPage.getByText(SCORE_FRACTION).first()).toBeVisible();

  // ——— Teacher: the results table shows the submission and its score ———
  await teacherPage.goto(examUrl);
  const studentRow = teacherPage
    .getByRole("row")
    .filter({ hasText: boot.studentName });
  await expect(studentRow.getByText("سلّم", { exact: true })).toBeVisible();
  await expect(studentRow.getByText(SCORE_FRACTION).first()).toBeVisible();

  await studentContext.close();
  await teacherContext.close();
});
