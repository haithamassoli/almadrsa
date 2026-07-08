import { makeErrors } from "@/lib/errors";

/** ConvexError rejection codes from convex/academics.ts → Arabic copy. */
export const structureError = makeErrors({
  grade_not_empty: "structure.errGradeNotEmpty",
  subject_in_use: "structure.errSubjectInUse",
  class_not_empty: "structure.errClassNotEmpty",
  term_dates: "structure.errTermDates",
  term_is_active: "structure.errTermIsActive",
  assignment_duplicate: "structure.errAssignmentDuplicate",
  assignment_grade_mismatch: "structure.errAssignmentGradeMismatch",
  assignment_teacher_invalid: "structure.errAssignmentTeacherInvalid",
  grade_not_found: "structure.errNotFound",
  subject_not_found: "structure.errNotFound",
  class_not_found: "structure.errNotFound",
  term_not_found: "structure.errNotFound",
  assignment_not_found: "structure.errNotFound",
  invalid_input: "structure.errInvalidInput",
}).mutationErrorText;
