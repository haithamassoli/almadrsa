import { makeErrors } from "@/lib/errors";

/** Backend machine codes (ConvexError data) → Arabic messages. */
export const { errorText, mutationErrorText } = makeErrors({
  not_found: "exams.errNotFound",
  invalid_exam: "exams.errInvalidExam",
  exam_not_editable: "exams.errNotEditable",
  window_past: "exams.errWindowPast",
  not_assigned: "exams.errNotAssigned",
  exam_not_published: "exams.errNotPublished",
  invalid_score: "exams.errInvalidScore",
  not_submitted: "exams.errNotSubmitted",
  invalid_grading: "exams.errInvalidGrading",
  insufficient_bank: "exams.errInsufficientBank",
});
