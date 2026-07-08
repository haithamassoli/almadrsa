import { makeErrors } from "@/lib/errors";

/** Backend machine codes (ConvexError data) → Arabic messages. */
export const { errorText, mutationErrorText } = makeErrors({
  invalid_note: "notes.errInvalidNote",
  not_owner: "notes.errNotOwner",
  not_found: "notes.errNotFound",
});
