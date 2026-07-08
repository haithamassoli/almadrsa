import { makeErrors } from "@/lib/errors";

/** Backend machine codes (ConvexError data) → Arabic messages. */
export const { errorText, mutationErrorText } = makeErrors({
  not_found: "homework.errNotFound",
  not_assigned: "homework.errNotAssigned",
  invalid_homework: "homework.errInvalidHomework",
  has_submissions: "homework.errHasSubmissions",
  homework_closed: "homework.errHomeworkClosed",
  invalid_grade: "homework.errInvalidGrade",
});
