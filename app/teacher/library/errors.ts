import { makeErrors } from "@/lib/errors";

/** Backend machine codes (ConvexError data) → Arabic messages. */
export const { errorText, mutationErrorText } = makeErrors({
  not_found: "library.errNotFound",
  not_assigned: "library.errNotAssigned",
  invalid_resource: "library.errInvalidResource",
});
