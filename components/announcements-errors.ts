import { makeErrors } from "@/lib/errors";

/** Backend machine codes (ConvexError data) → Arabic messages. */
export const { errorText, mutationErrorText } = makeErrors({
  invalid_announcement: "announce.errInvalidAnnouncement",
  not_owner: "announce.errNotOwner",
  not_assigned: "announce.errNotAssigned",
  not_found: "announce.errNotFound",
});
