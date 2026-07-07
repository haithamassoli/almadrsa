import { ConvexError } from "convex/values";
import { t } from "@/lib/i18n";

/** Map ConvexError rejection codes from convex/academics.ts to Arabic copy. */
export function structureError(err: unknown): string {
  const code =
    err instanceof ConvexError && typeof err.data === "string" ? err.data : "";
  switch (code) {
    case "grade_not_empty":
      return t("structure.errGradeNotEmpty");
    case "subject_in_use":
      return t("structure.errSubjectInUse");
    case "class_not_empty":
      return t("structure.errClassNotEmpty");
    case "term_dates":
      return t("structure.errTermDates");
    case "term_is_active":
      return t("structure.errTermIsActive");
    case "assignment_duplicate":
      return t("structure.errAssignmentDuplicate");
    case "assignment_grade_mismatch":
      return t("structure.errAssignmentGradeMismatch");
    case "assignment_teacher_invalid":
      return t("structure.errAssignmentTeacherInvalid");
    case "grade_not_found":
    case "subject_not_found":
    case "class_not_found":
    case "term_not_found":
    case "assignment_not_found":
      return t("structure.errNotFound");
    case "invalid_input":
      return t("structure.errInvalidInput");
    default:
      return t("common.errorGeneric");
  }
}
