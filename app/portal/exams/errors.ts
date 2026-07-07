import { ConvexError } from "convex/values";
import { t } from "@/lib/i18n";

/** Backend machine codes (ConvexError data) → Arabic messages. */
const ERROR_KEYS = {
  not_found: "examsPortal.errNotFound",
  exam_not_open: "examsPortal.errExamNotOpen",
  not_enrolled: "examsPortal.errNotEnrolled",
  attempt_expired: "examsPortal.errAttemptExpired",
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
