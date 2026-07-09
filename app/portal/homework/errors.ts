import { makeErrors } from "@/lib/errors";
export { errorCode } from "@/lib/errors";

/**
 * Backend machine codes (ConvexError data) → Arabic messages for the M9
 * student homework screens (homework.getForStudent / homework.submit).
 */
export const { errorText, mutationErrorText } = makeErrors({
  not_found: "homeworkPortal.errNotFound",
  homework_closed: "homeworkPortal.errHomeworkClosed",
  empty_submission: "homeworkPortal.errEmptySubmission",
  invalid_submission: "homeworkPortal.errInvalidSubmission",
  invalid_file: "homeworkPortal.errInvalidFile",
});
