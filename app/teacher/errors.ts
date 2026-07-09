import { makeErrors } from "@/lib/errors";

/** Backend machine codes (ConvexError data) → Arabic messages. */
export const { errorText, mutationErrorText } = makeErrors({
  not_found: "lessons.errNotFound",
  invalid_date: "lessons.errInvalidDate",
  invalid_period: "lessons.errInvalidPeriod",
  not_assigned: "lessons.errNotAssigned",
  too_many_resources: "lessons.errTooManyResources",
  invalid_url: "lessons.errInvalidUrl",
  lesson_has_attendance: "lessons.errLessonHasAttendance",
  too_many_entries: "lessons.errTooManyEntries",
});
