import { v } from "convex/values";
import { query, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireTeacher } from "./auth";
import { isValidDateKey } from "./lib/dates";
import { assertStaffCanAccessClass } from "./students";
import { requireStudentAccount } from "./studentAuth";

/**
 * M14 — interactive calendar: one merged month view over lessons, exam
 * windows, homework deadlines, and school events/holidays. Read-only; the
 * staff and portal queries return the same day-bucket shape so both grids
 * share a component. Every source read is index-scoped and bounded (caps
 * commented at each scan); days with no items are omitted.
 *
 * refId semantics: lesson → lessonId (staff routes only — portal lesson
 * items are informational) · exam → examId (portal routes
 * /portal/exams/{id}) · homework → homeworkId · holiday/event → eventId.
 */

/** "YYYY-MM-DD" UTC day key — the convention lessons/pointEvents use. */
function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

type CalendarItem = {
  kind: "lesson" | "exam" | "homework" | "holiday" | "event";
  title: string;
  refId: string;
};

/** Shared `returns` validator of both month queries. */
const calendarDays = v.array(
  v.object({
    date: v.string(),
    items: v.array(
      v.object({
        kind: v.union(
          v.literal("lesson"),
          v.literal("exam"),
          v.literal("homework"),
          v.literal("holiday"),
          v.literal("event"),
        ),
        title: v.string(),
        refId: v.string(),
      }),
    ),
  }),
);

/** Append an item onto its day bucket (buckets exist iff nonempty). */
function addItem(
  days: Map<string, Array<CalendarItem>>,
  date: string,
  item: CalendarItem,
): void {
  const bucket = days.get(date);
  if (bucket) bucket.push(item);
  else days.set(date, [item]);
}

/** Cached subject-name lookup for the lesson titles. */
async function subjectNameOf(
  ctx: QueryCtx,
  subjectId: Id<"subjects">,
  cache: Map<Id<"subjects">, string>,
): Promise<string> {
  const cached = cache.get(subjectId);
  if (cached !== undefined) return cached;
  const subject = await ctx.db.get("subjects", subjectId);
  const name = subject?.name ?? "";
  cache.set(subjectId, name);
  return name;
}

/**
 * Merge one class's lessons, exams and homework into the day buckets.
 * Caps per class: 300 lessons in the range (a month holds ≤ ~200 taught
 * periods) · 100 published + 100 closed exams, newest first · newest 200
 * homework (older rows cannot have a deadline inside a current range).
 */
async function collectClassItems(
  ctx: QueryCtx,
  classId: Id<"classes">,
  from: string,
  to: string,
  days: Map<string, Array<CalendarItem>>,
  subjectNames: Map<Id<"subjects">, string>,
): Promise<void> {
  // Lessons of the range, merged in (date, period) order.
  const lessons = await ctx.db
    .query("lessons")
    .withIndex("by_classId_and_date", (q) =>
      q.eq("classId", classId).gte("date", from).lte("date", to),
    )
    .take(300);
  lessons.sort((a, b) =>
    a.date === b.date ? a.period - b.period : a.date < b.date ? -1 : 1,
  );
  for (const lesson of lessons) {
    const subjectName = await subjectNameOf(
      ctx,
      lesson.subjectId,
      subjectNames,
    );
    addItem(days, lesson.date, {
      kind: "lesson",
      title: `${subjectName} · الحصة ${lesson.period}`,
      refId: lesson._id,
    });
  }

  // Exams whose window OPENS in the range, keyed on windowStart's day.
  // Both student-visible statuses — drafts are excluded by construction
  // (these index scans can never return them).
  for (const status of ["published", "closed"] as const) {
    const exams = await ctx.db
      .query("exams")
      .withIndex("by_classId_and_status", (q) =>
        q.eq("classId", classId).eq("status", status),
      )
      .order("desc")
      .take(100);
    for (const exam of exams) {
      const date = dayKey(exam.windowStart);
      if (date < from || date > to) continue;
      addItem(days, date, {
        kind: "exam",
        title: `اختبار: ${exam.title}`,
        refId: exam._id,
      });
    }
  }

  // Homework keyed on its deadline day (any status — the deadline is what
  // the calendar shows).
  const homeworkList = await ctx.db
    .query("homework")
    .withIndex("by_classId", (q) => q.eq("classId", classId))
    .order("desc")
    .take(200);
  for (const homework of homeworkList) {
    const date = dayKey(homework.deadline);
    if (date < from || date > to) continue;
    addItem(days, date, {
      kind: "homework",
      title: `واجب: ${homework.title}`,
      refId: homework._id,
    });
  }
}

/**
 * Events whose START day falls in [from, to] (≤200 — far above a month of
 * school events), filtered to school-wide rows or one of `classIds`. One
 * pass regardless of how many classes merge, so school-wide events never
 * duplicate.
 */
async function collectEvents(
  ctx: QueryCtx,
  classIds: Set<Id<"classes">>,
  from: string,
  to: string,
  days: Map<string, Array<CalendarItem>>,
): Promise<void> {
  const events = await ctx.db
    .query("events")
    .withIndex("by_date", (q) => q.gte("date", from).lte("date", to))
    .take(200);
  for (const event of events) {
    if (event.classId !== undefined && !classIds.has(event.classId)) continue;
    addItem(days, event.date, {
      kind: event.kind, // "holiday" | "event"
      title: event.title,
      refId: event._id,
    });
  }
}

/** Day buckets → date-sorted array (only nonempty days ever exist). */
function toSortedDays(
  days: Map<string, Array<CalendarItem>>,
): Array<{ date: string; items: Array<CalendarItem> }> {
  return [...days.entries()]
    .map(([date, items]) => ({ date, items }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * The month view of one class for staff (teacher must be assigned to it;
 * admins pass): lessons + exam windows + homework deadlines + events that
 * are school-wide or scoped to this class. Malformed range keys read as an
 * empty month rather than an error.
 */
export const monthForStaff = query({
  args: { classId: v.id("classes"), from: v.string(), to: v.string() },
  returns: calendarDays,
  handler: async (ctx, args) => {
    const staff = await requireTeacher(ctx);
    await assertStaffCanAccessClass(ctx, staff, args.classId);
    if (!isValidDateKey(args.from) || !isValidDateKey(args.to)) return [];

    const days = new Map<string, Array<CalendarItem>>();
    const subjectNames = new Map<Id<"subjects">, string>();
    await collectClassItems(
      ctx,
      args.classId,
      args.from,
      args.to,
      days,
      subjectNames,
    );
    await collectEvents(ctx, new Set([args.classId]), args.from, args.to, days);
    return toSortedDays(days);
  },
});

/**
 * The student's month view: the same merge over every class they are
 * actively enrolled in (≤20), with events school-wide or scoped to one of
 * their own classes. Same shape as monthForStaff; exam/homework refIds
 * route to the portal detail pages, lesson items are informational.
 */
export const monthForStudent = query({
  args: { sessionToken: v.string(), from: v.string(), to: v.string() },
  returns: calendarDays,
  handler: async (ctx, args) => {
    const { studentId } = await requireStudentAccount(ctx, args.sessionToken);
    if (!isValidDateKey(args.from) || !isValidDateKey(args.to)) return [];
    const enrollments = await ctx.db
      .query("enrollments")
      .withIndex("by_studentId_and_active", (q) =>
        q.eq("studentId", studentId).eq("active", true),
      )
      .take(20);

    const days = new Map<string, Array<CalendarItem>>();
    const subjectNames = new Map<Id<"subjects">, string>();
    const classIds = new Set<Id<"classes">>();
    for (const enrollment of enrollments) {
      if (classIds.has(enrollment.classId)) continue; // defensive dedupe
      classIds.add(enrollment.classId);
      await collectClassItems(
        ctx,
        enrollment.classId,
        args.from,
        args.to,
        days,
        subjectNames,
      );
    }
    await collectEvents(ctx, classIds, args.from, args.to, days);
    return toSortedDays(days);
  },
});
