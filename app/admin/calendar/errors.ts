import { makeErrors } from "@/lib/errors";

/** Backend machine codes (ConvexError data) → Arabic messages. */
export const { errorText, mutationErrorText } = makeErrors({
  invalid_event: "calendarUi.errInvalidEvent",
  not_found: "calendarUi.errNotFound",
});
