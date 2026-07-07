import { ConvexError } from "convex/values";
import { t } from "@/lib/i18n";

/**
 * Backend machine codes (ConvexError data) → Arabic messages for the M9
 * student homework screens (homework.getForStudent / homework.submit).
 */
const ERROR_KEYS = {
  not_found: "homeworkPortal.errNotFound",
  homework_closed: "homeworkPortal.errHomeworkClosed",
  empty_submission: "homeworkPortal.errEmptySubmission",
  invalid_submission: "homeworkPortal.errInvalidSubmission",
  invalid_file: "homeworkPortal.errInvalidFile",
} as const;

/** The machine code carried by a ConvexError, if any. */
export function errorCode(error: unknown): string | undefined {
  return error instanceof ConvexError && typeof error.data === "string"
    ? error.data
    : undefined;
}

export function errorText(code: string | undefined): string {
  const key =
    code !== undefined && code in ERROR_KEYS
      ? ERROR_KEYS[code as keyof typeof ERROR_KEYS]
      : undefined;
  return key ? t(key) : t("common.errorGeneric");
}

export function mutationErrorText(error: unknown): string {
  return errorText(errorCode(error));
}
