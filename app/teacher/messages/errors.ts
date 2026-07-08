import { makeErrors } from "@/lib/errors";

/** Backend machine codes (ConvexError data) → Arabic messages. */
export const { errorText, mutationErrorText } = makeErrors({
  invalid_message: "messagesUi.errInvalidMessage",
  not_found: "messagesUi.errNotFound",
});
