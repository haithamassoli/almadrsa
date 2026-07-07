import { ar } from "./ar";

// Arabic is the only shipped locale; every UI string flows through t() so a
// second locale later is a new dictionary, not a rewrite.
export const locale = "ar" as const;

type Join<K, P> = K extends string
  ? P extends string
    ? `${K}.${P}`
    : never
  : never;
type Paths<T> = {
  [K in keyof T]: T[K] extends string ? K : Join<K, Paths<T[K]>>;
}[keyof T];

export type MessageKey = Paths<typeof ar>;

export function t(
  key: MessageKey,
  params?: Record<string, string | number>,
): string {
  const raw = key
    .split(".")
    .reduce<unknown>(
      (obj, part) => (obj as Record<string, unknown> | undefined)?.[part],
      ar,
    );
  let message = typeof raw === "string" ? raw : key;
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      message = message.replaceAll(`{${name}}`, String(value));
    }
  }
  return message;
}

// Gregorian calendar with Latin digits, Arabic month/day names.
const dateFormat = new Intl.DateTimeFormat("ar-u-ca-gregory-nu-latn", {
  dateStyle: "medium",
});
const dateTimeFormat = new Intl.DateTimeFormat("ar-u-ca-gregory-nu-latn", {
  dateStyle: "medium",
  timeStyle: "short",
});
const numberFormat = new Intl.NumberFormat("ar-u-nu-latn");

export function formatDate(ms: number): string {
  return dateFormat.format(ms);
}
export function formatDateTime(ms: number): string {
  return dateTimeFormat.format(ms);
}
export function formatNumber(n: number): string {
  return numberFormat.format(n);
}
