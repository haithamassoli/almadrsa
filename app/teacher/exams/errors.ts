import { ConvexError } from "convex/values";
import { t } from "@/lib/i18n";

/** Backend machine codes (ConvexError data) → Arabic messages. */
const ERROR_KEYS = {
  not_found: "exams.errNotFound",
  invalid_exam: "exams.errInvalidExam",
  exam_not_editable: "exams.errNotEditable",
  window_past: "exams.errWindowPast",
  not_assigned: "exams.errNotAssigned",
  exam_not_published: "exams.errNotPublished",
  invalid_score: "exams.errInvalidScore",
  not_submitted: "exams.errNotSubmitted",
  invalid_grading: "exams.errInvalidGrading",
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
