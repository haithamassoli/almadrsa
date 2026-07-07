import { ConvexError } from "convex/values";
import { t } from "@/lib/i18n";

/** Backend machine codes (ConvexError data) → Arabic messages. */
const ERROR_KEYS = {
  not_found: "lessons.errNotFound",
  invalid_date: "lessons.errInvalidDate",
  invalid_period: "lessons.errInvalidPeriod",
  not_assigned: "lessons.errNotAssigned",
  too_many_resources: "lessons.errTooManyResources",
  invalid_url: "lessons.errInvalidUrl",
  lesson_has_attendance: "lessons.errLessonHasAttendance",
  too_many_entries: "lessons.errTooManyEntries",
} as const;

export function errorText(code: string | undefined): string {
  const key =
    code !== undefined && code in ERROR_KEYS
      ? ERROR_KEYS[code as keyof typeof ERROR_KEYS]
      : undefined;
  return key ? t(key) : t("common.errorGeneric");
}

export function mutationErrorText(error: unknown): string {
  if (error instanceof ConvexError && typeof error.data === "string") {
    return errorText(error.data);
  }
  return t("common.errorGeneric");
}
