import { makeErrors } from "@/lib/errors";
export { errorCode } from "@/lib/errors";

/** Backend machine codes (ConvexError data) → Arabic messages. */
export const { errorText, mutationErrorText } = makeErrors({
  not_found: "examsPortal.errNotFound",
  exam_not_open: "examsPortal.errExamNotOpen",
  not_enrolled: "examsPortal.errNotEnrolled",
  attempt_expired: "examsPortal.errAttemptExpired",
});
