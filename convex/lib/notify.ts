import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import type { NotificationType } from "./validators";

/**
 * M5 — in-app notification fan-out. Plain helpers called from inside the
 * mutation that caused the event, so the notifications commit (or roll back)
 * atomically with it. One row per recipient; bounded everywhere. Notification
 * copy is composed in Arabic at the call site — the server has no i18n layer.
 */

export type NotificationPayload = {
  type: NotificationType;
  title: string;
  body: string;
  refType?: string;
  refId?: string;
};

/** Hard cap on recipients of a single fan-out (single-school scale). */
const MAX_FANOUT = 2000;

/** Insert one notification per student (ids deduped, capped at 2000). */
export async function notifyStudents(
  ctx: MutationCtx,
  studentIds: Array<Id<"students">>,
  payload: NotificationPayload,
): Promise<void> {
  const unique = [...new Set(studentIds)].slice(0, MAX_FANOUT);
  for (const studentId of unique) {
    await ctx.db.insert("notifications", {
      studentId,
      type: payload.type,
      title: payload.title,
      body: payload.body,
      read: false,
      refType: payload.refType,
      refId: payload.refId,
    });
  }
}

/** Notify every student actively enrolled in a class. */
export async function notifyClass(
  ctx: MutationCtx,
  classId: Id<"classes">,
  payload: NotificationPayload,
): Promise<void> {
  const enrollments = await ctx.db
    .query("enrollments")
    .withIndex("by_classId_and_active", (q) =>
      q.eq("classId", classId).eq("active", true),
    )
    .take(500);
  await notifyStudents(
    ctx,
    enrollments.map((enrollment) => enrollment.studentId),
    payload,
  );
}

/** Notify every active student (school-wide announcements). */
export async function notifyAllActiveStudents(
  ctx: MutationCtx,
  payload: NotificationPayload,
): Promise<void> {
  const students = await ctx.db
    .query("students")
    .withIndex("by_status", (q) => q.eq("status", "active"))
    .take(MAX_FANOUT);
  await notifyStudents(
    ctx,
    students.map((student) => student._id),
    payload,
  );
}

// ——— Arabic date fragments for notification copy ———
// Mirrors the client's formatDate style (Arabic month names, Latin digits,
// Gregorian) without relying on Intl locale data in the Convex runtime.
// Timestamps are rendered as UTC calendar dates (date-only, so a school-hours
// timestamp lands on the right day); exact local times stay a client concern.

const ARABIC_MONTHS = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
];

/** "15 سبتمبر 2026" from a ms timestamp (UTC calendar date). */
export function formatDateAr(ms: number): string {
  const date = new Date(ms);
  return `${date.getUTCDate()} ${ARABIC_MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** "15 سبتمبر 2026" from a "YYYY-MM-DD" date key (no timezone involved). */
export function formatDateKeyAr(dateKey: string): string {
  const year = Number(dateKey.slice(0, 4));
  const month = Number(dateKey.slice(5, 7));
  const day = Number(dateKey.slice(8, 10));
  const monthName = ARABIC_MONTHS[month - 1];
  if (!monthName || !Number.isFinite(year) || !Number.isFinite(day)) {
    return dateKey;
  }
  return `${day} ${monthName} ${year}`;
}
