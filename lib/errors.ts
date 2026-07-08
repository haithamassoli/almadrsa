import { ConvexError } from "convex/values";
import { t, type MessageKey } from "@/lib/i18n";

/** The machine code carried by a ConvexError (its string `data`), if any. */
export function errorCode(error: unknown): string | undefined {
  return error instanceof ConvexError && typeof error.data === "string"
    ? error.data
    : undefined;
}

/**
 * Per-page error helpers from a backend-code → i18n-key map. Unknown or absent
 * codes fall back to common.errorGeneric. Each feature's errors.ts supplies its
 * own map; the lookup/formatting logic lives here once.
 */
export function makeErrors(keys: Record<string, MessageKey>) {
  const errorText = (code: string | undefined): string => {
    const key = code ? keys[code] : undefined;
    return t(key ?? "common.errorGeneric");
  };
  return {
    errorText,
    mutationErrorText: (error: unknown) => errorText(errorCode(error)),
  };
}
