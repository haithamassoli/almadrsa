import { makeErrors } from "@/lib/errors";

/** Backend machine codes (ConvexError data) → Arabic messages. */
export const { errorText, mutationErrorText } = makeErrors({
  invalid_firstName: "students.errInvalidFirstName",
  invalid_lastName: "students.errInvalidLastName",
  invalid_guardianName: "students.errInvalidGuardianName",
  invalid_phone: "students.errInvalidPhone",
  class_not_found: "students.errClassNotFound",
  class_ambiguous: "students.errClassAmbiguous",
  too_many_rows: "students.errTooManyRows",
  not_found: "students.errNotFound",
});
