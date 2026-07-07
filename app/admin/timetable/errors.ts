import { ConvexError } from "convex/values";
import { t } from "@/lib/i18n";

/** Backend machine codes (ConvexError data) → Arabic messages. */
const ERROR_KEYS = {
  teacher_busy: "timetable.errTeacherBusy",
  subject_grade_mismatch: "timetable.errSubjectGradeMismatch",
  not_found: "timetable.errNotFound",
  // invalid_slot falls through to the generic message.
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
