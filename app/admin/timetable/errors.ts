import { makeErrors } from "@/lib/errors";

/** Backend machine codes (ConvexError data) → Arabic messages. */
export const { errorText, mutationErrorText } = makeErrors({
  teacher_busy: "timetable.errTeacherBusy",
  subject_grade_mismatch: "timetable.errSubjectGradeMismatch",
  not_found: "timetable.errNotFound",
  // invalid_slot falls through to the generic message.
});
