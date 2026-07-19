import { execSync } from "node:child_process";
import * as path from "node:path";
import { devices, type Browser, type BrowserContext, type Page } from "@playwright/test";

// Dev-only seeded staff account (see convex/seed.ts createStaff docs).
export const TEACHER_EMAIL = "teacher@almdrasa.dev";
export const TEACHER_PASSWORD = "Madrasa!Teacher2026";

// Stable demo constants mirrored from convex/seed.ts.
export const DEMO_CLASS_NAME = "الصف الرابع — أ";
export const DEMO_SUBJECT_NAME = "التربية الإسلامية";

const REPO_ROOT = path.resolve(__dirname, "..");

export type BootstrapResult = { code: string; studentName: string };

/**
 * Ensure the demo dataset exists and get a fresh access code for the demo
 * student, via the dev deployment's internal seed:e2eBootstrap mutation.
 * The CLI may prefix warnings/notices, so parse from the first "{".
 */
export function bootstrap(): BootstrapResult {
  const stdout = execSync("npx convex run seed:e2eBootstrap '{}'", {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start === -1 || end < start) {
    throw new Error(`Unexpected convex run output:\n${stdout}`);
  }
  const parsed = JSON.parse(stdout.slice(start, end + 1)) as BootstrapResult;
  if (!parsed.code || !parsed.studentName) {
    throw new Error(`seed:e2eBootstrap returned incomplete data:\n${stdout}`);
  }
  return parsed;
}

/**
 * A dedicated phone-sized context per actor: the specs drive a teacher and a
 * student side by side without signing each other out (and without touching
 * any session a human may have open in their own browser).
 */
export async function newPhoneContext(browser: Browser): Promise<BrowserContext> {
  const phone = devices["iPhone 13"];
  return browser.newContext({
    viewport: phone.viewport,
    userAgent: phone.userAgent,
    deviceScaleFactor: phone.deviceScaleFactor,
    isMobile: phone.isMobile,
    hasTouch: phone.hasTouch,
  });
}

/** Staff email/password login; resolves once a staff area URL is reached. */
export async function staffLogin(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("البريد الإلكتروني").fill(email);
  await page.getByLabel("كلمة المرور").fill(password);
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  await page.waitForURL(/\/(teacher|admin)(\/|$)/);
}

/**
 * Student code login. Fresh codes have no PIN, so the optional PIN-setup step
 * usually appears — skip it ("تخطي") and land on /portal.
 */
export async function studentLogin(page: Page, code: string): Promise<void> {
  await page.goto("/code");
  await page.getByLabel("رمز الدخول").fill(code);
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();

  const skip = page.getByRole("button", { name: "تخطي" });
  await Promise.race([
    page.waitForURL(/\/portal(\/|$)/).catch(() => undefined),
    skip.waitFor({ state: "visible" }).catch(() => undefined),
  ]);
  if (!/\/portal(\/|$)/.test(page.url())) {
    await skip.click();
    await page.waitForURL(/\/portal(\/|$)/);
  }
}
