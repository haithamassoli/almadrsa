import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireTeacher } from "./auth";
import { awardForAttendance } from "./gamification";
import { getOwnedLesson } from "./lessons";
import { assertStaffCanAccessStudent } from "./students";
import { logAudit } from "./lib/audit";
import { formatDateKeyAr, notifyStudents } from "./lib/notify";
import { attendanceStatus, type AttendanceStatus } from "./lib/validators";

/**
 * M3 — per-lesson attendance. One row per (lesson, student), written only by
 * the lesson's owner (or an admin). `classId` and `date` are denormalized
 * from the lesson so per-student history reads stay index-only. Domain
 * errors use `ConvexError` codes the RTL UI maps to Arabic messages:
 *   not_found · too_many_entries
 */

/**
 * Upsert ONE (lesson, student) attendance row — the single write path shared
 * by the teacher marking sheet (bulkMark) and the M11 QR check-in
 * (checkin.checkIn). Patches or inserts the row (classId/date denormalized
 * from the lesson) and fires the M6 gamification hook on a transition INTO
 * present/late — re-saving the same status stays silent (awardOnce dedupes
 * per row regardless). Returns the row id and the status it had before
 * (null = not marked yet) so callers can detect transitions (bulkMark's
 * absence notifications). Enrollment/authorization stay with the callers.
 */
export async function markOneAttendance(
  ctx: MutationCtx,
  args: {
    lesson: Doc<"lessons">;
    studentId: Id<"students">;
    status: AttendanceStatus;
    markedBy: string; // Better Auth user id, or "qr" for self check-in
  },
): Promise<{
  attendanceId: Id<"attendance">;
  previousStatus: AttendanceStatus | null;
}> {
  const existing = await ctx.db
    .query("attendance")
    .withIndex("by_lessonId_and_studentId", (q) =>
      q.eq("lessonId", args.lesson._id).eq("studentId", args.studentId),
    )
    .unique();
  let attendanceId: Id<"attendance">;
  if (existing) {
    await ctx.db.patch("attendance", existing._id, {
      status: args.status,
      markedBy: args.markedBy,
      updatedAt: Date.now(),
    });
    attendanceId = existing._id;
  } else {
    attendanceId = await ctx.db.insert("attendance", {
      lessonId: args.lesson._id,
      studentId: args.studentId,
      classId: args.lesson.classId,
      date: args.lesson.date,
      status: args.status,
      markedBy: args.markedBy,
      updatedAt: Date.now(),
    });
  }
  if (
    (args.status === "present" || args.status === "late") &&
    existing?.status !== args.status
  ) {
    await awardForAttendance(ctx, {
      studentId: args.studentId,
      attendanceId,
      status: args.status,
      date: args.lesson.date,
    });
  }
  return { attendanceId, previousStatus: existing?.status ?? null };
}

/**
 * The marking sheet for a lesson: every actively enrolled student of the
 * lesson's class with their current status (null = not marked yet), sorted
 * by first name.
 */
export const roster = query({
  args: { lessonId: v.id("lessons") },
  returns: v.array(
    v.object({
      studentId: v.id("students"),
      firstName: v.string(),
      lastName: v.string(),
      status: v.union(attendanceStatus, v.null()),
    }),
  ),
  handler: async (ctx, args) => {
    const staff = await requireTeacher(ctx);
    const lesson = await getOwnedLesson(ctx, staff, args.lessonId);

    const existing = await ctx.db
      .query("attendance")
      .withIndex("by_lessonId_and_studentId", (q) =>
        q.eq("lessonId", args.lessonId),
      )
      .take(500);
    const statusByStudent = new Map<Id<"students">, AttendanceStatus>();
    for (const row of existing) {
      statusByStudent.set(row.studentId, row.status);
    }

    const enrollments = await ctx.db
      .query("enrollments")
      .withIndex("by_classId_and_active", (q) =>
        q.eq("classId", lesson.classId).eq("active", true),
      )
      .take(200);
    const rows: Array<{
      studentId: Id<"students">;
      firstName: string;
      lastName: string;
      status: AttendanceStatus | null;
    }> = [];
    for (const enrollment of enrollments) {
      const student = await ctx.db.get("students", enrollment.studentId);
      if (!student) continue;
      rows.push({
        studentId: student._id,
        firstName: student.firstName,
        lastName: student.lastName,
        status: statusByStudent.get(student._id) ?? null,
      });
    }
    rows.sort((a, b) =>
      a.firstName < b.firstName ? -1 : a.firstName > b.firstName ? 1 : 0,
    );
    return rows;
  },
});

/**
 * Save a whole marking sheet in one transaction (owner-or-admin). Entries
 * for students not actively enrolled in the lesson's class are skipped
 * silently (roster drift between render and submit). Upserts per student;
 * one audit row for the batch.
 */
export const bulkMark = mutation({
  args: {
    lessonId: v.id("lessons"),
    entries: v.array(
      v.object({ studentId: v.id("students"), status: attendanceStatus }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await requireTeacher(ctx);
    const lesson = await getOwnedLesson(ctx, staff, args.lessonId);
    if (args.entries.length > 200) throw new ConvexError("too_many_entries");

    const enrollments = await ctx.db
      .query("enrollments")
      .withIndex("by_classId_and_active", (q) =>
        q.eq("classId", lesson.classId).eq("active", true),
      )
      .take(500);
    const enrolled = new Set<Id<"students">>(
      enrollments.map((enrollment) => enrollment.studentId),
    );

    const newlyAbsent: Array<Id<"students">> = [];
    for (const entry of args.entries) {
      if (!enrolled.has(entry.studentId)) continue;
      // Shared single-row upsert (also the QR check-in write path): patches
      // or inserts, and fires the M6 award on a transition into present/late.
      const { previousStatus } = await markOneAttendance(ctx, {
        lesson,
        studentId: entry.studentId,
        status: entry.status,
        markedBy: staff.id,
      });
      // M5: notify only on a transition INTO "absent" (unmarked or another
      // status before) — re-saving an existing absence stays silent.
      if (entry.status === "absent" && previousStatus !== "absent") {
        newlyAbsent.push(entry.studentId);
      }
    }

    if (newlyAbsent.length > 0) {
      const subject = await ctx.db.get("subjects", lesson.subjectId);
      await notifyStudents(ctx, newlyAbsent, {
        type: "absence",
        title: "غياب مسجَّل",
        body: `سُجّل غياب عن حصة ${subject?.name ?? ""} بتاريخ ${formatDateKeyAr(lesson.date)}`,
        refType: "attendance",
      });
    }

    await logAudit(ctx, {
      actorType: "staff",
      actorId: staff.id,
      action: "attendance.mark",
      targetType: "lesson",
      targetId: args.lessonId,
      meta: { total: args.entries.length },
    });
    return null;
  },
});

/**
 * A student's attendance in a date range (newest first) with per-status
 * totals. Teacher must be assigned to one of the student's active classes;
 * admins pass.
 */
export const historyForStudent = query({
  args: { studentId: v.id("students"), from: v.string(), to: v.string() },
  returns: v.object({
    rows: v.array(
      v.object({
        date: v.string(),
        period: v.number(),
        subjectName: v.string(),
        status: attendanceStatus,
      }),
    ),
    totals: v.object({
      present: v.number(),
      absent: v.number(),
      late: v.number(),
    }),
  }),
  handler: async (ctx, args) => {
    const staff = await requireTeacher(ctx);
    await assertStaffCanAccessStudent(ctx, staff, args.studentId);

    const records = await ctx.db
      .query("attendance")
      .withIndex("by_studentId_and_date", (q) =>
        q
          .eq("studentId", args.studentId)
          .gte("date", args.from)
          .lte("date", args.to),
      )
      .order("desc")
      .take(200);

    const subjectNames = new Map<Id<"subjects">, string>();
    const totals = { present: 0, absent: 0, late: 0 };
    const rows: Array<{
      date: string;
      period: number;
      subjectName: string;
      status: AttendanceStatus;
    }> = [];
    for (const record of records) {
      // Lessons with attendance are undeletable, so this always resolves;
      // skip defensively if an old row ever dangles.
      const lesson = await ctx.db.get("lessons", record.lessonId);
      if (!lesson) continue;
      let subjectName = subjectNames.get(lesson.subjectId);
      if (subjectName === undefined) {
        const subject = await ctx.db.get("subjects", lesson.subjectId);
        subjectName = subject?.name ?? "";
        subjectNames.set(lesson.subjectId, subjectName);
      }
      totals[record.status]++;
      rows.push({
        date: record.date,
        period: lesson.period,
        subjectName,
        status: record.status,
      });
    }
    return { rows, totals };
  },
});
