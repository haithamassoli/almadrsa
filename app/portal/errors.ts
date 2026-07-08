import { makeErrors } from "@/lib/errors";
export { errorCode } from "@/lib/errors";

/**
 * Backend machine codes (ConvexError data) → Arabic messages, shared by the
 * M5 portal pages (home, attendance, notifications, announcements). The exam
 * screens keep their own richer map in app/portal/exams/errors.ts.
 */
export const { errorText, mutationErrorText } = makeErrors({
  not_found: "portal.errNotFound",
});
