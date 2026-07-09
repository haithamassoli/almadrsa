import { makeErrors } from "@/lib/errors";

/** Backend machine codes (ConvexError data) → Arabic messages. */
export const { errorText, mutationErrorText } = makeErrors({
  not_found: "reports.errNotFound",
  class_not_found: "reports.errClassNotFound",
  term_not_found: "reports.errTermNotFound",
  report_published: "reports.errPublished",
  invalid_input: "reports.errInvalidInput",
});
