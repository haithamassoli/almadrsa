import { makeErrors } from "@/lib/errors";

/** Backend machine codes (ConvexError data) → Arabic messages. */
export const { errorText, mutationErrorText } = makeErrors({
  invalid_question: "questions.errInvalidQuestion",
  not_assigned: "questions.errNotAssigned",
  not_owner: "questions.errNotOwner",
  not_found: "questions.errNotFound",
});
