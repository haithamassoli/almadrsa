import { ConvexError } from "convex/values";
import { t } from "@/lib/i18n";

/**
 * Backend machine codes (ConvexError data) → Arabic messages, shared by the
 * M5 portal pages (home, attendance, notifications, announcements). The exam
 * screens keep their own richer map in app/portal/exams/errors.ts.
 */
const ERROR_KEYS = {
  not_found: "portal.errNotFound",
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
