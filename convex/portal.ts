import { ConvexError, v } from "convex/values";
import { query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireStudentAccount } from "./studentAuth";
import {
  announcementsForStudent,
  studentAnnouncementValidator,
} from "./announcements";
import { staffNamesById } from "./notes";
import { attendanceStatus, type AttendanceStatus } from "./lib/validators";

/**
 * M5 — student/parent portal reads. Every query takes the bearer
 * `sessionToken`, resolves it via requireStudentAccount and only ever
 * returns the OWN student's data (plus content addressed to them). Date
 * args are "YYYY-MM-DD" keys computed by the client (today / range); a
 * malformed key simply matches nothing. Domain errors use `ConvexError`
 * codes the RTL UI maps to Arabic messages:
 *   not_found
 */

/**
 * Everything the portal home screen needs in one round trip: today's
 * lessons with the student's own attendance status, the latest exam
 * results, an attendance summary since `from`, the newest teacher notes
 * and the newest announcements.
 */
export const home = query({
  args: {
    sessionToken: v.string(),
    date: v.string(), // today, "YYYY-MM-DD"
    from: v.string(), // attendance window start (e.g. 30 days ago)
  },
  returns: v.object({
    student: v.object({ firstName: v.string(), lastName: v.string() }),
    todayLessons: v.array(
      v.object({
        lessonId: v.id("lessons"),
        period: v.number(),
        subjectName: v.string(),
        title: v.optional(v.string()),
        myStatus: v.union(attendanceStatus, v.null()),
      }),
    ),
    recentResults: v.array(
      v.object({
        examId: v.id("exams"),
        title: v.string(),
        score: v.number(),
        maxScore: v.number(),
        submittedAt: v.number(),
      }),
    ),
    attendance: v.object({
      present: v.number(),
      late: v.number(),
      absent: v.number(),
      rate: v.number(), // 0–100 integer; 0 when nothing marked yet
    }),
    gamification: v.object({
      totalPoints: v.number(),
      streak: v.number(), // consecutive active days
    }),
    notes: v.array(
      v.object({
        text: v.string(),
        teacherName: v.string(),
        _creationTime: v.number(),
      }),
    ),
    announcements: v.array(studentAnnouncementValidator),
  }),
  handler: async (ctx, args) => {
    const { studentId } = await requireStudentAccount(ctx, args.sessionToken);
    const student = await ctx.db.get("students", studentId);
    if (!student) throw new ConvexError("not_found");

    // Active classes (by convention one; bounded regardless).
    const enrollments = await ctx.db
      .query("enrollments")
      .withIndex("by_studentId_and_active", (q) =>
        q.eq("studentId", studentId).eq("active", true),
      )
      .take(20);
    const classIds = [
      ...new Set(enrollments.map((enrollment) => enrollment.classId)),
    ];

    // Today's lessons across those classes, by period, with own status.
    const lessons: Array<Doc<"lessons">> = [];
    for (const classId of classIds) {
      const rows = await ctx.db
        .query("lessons")
        .withIndex("by_classId_and_date", (q) =>
          q.eq("classId", classId).eq("date", args.date),
        )
        .take(20);
      lessons.push(...rows);
    }
    lessons.sort((a, b) => a.period - b.period);
    const subjectNames = new Map<Id<"subjects">, string>();
    const todayLessons = [];
    for (const lesson of lessons.slice(0, 20)) {
      let subjectName = subjectNames.get(lesson.subjectId);
      if (subjectName === undefined) {
        const subject = await ctx.db.get("subjects", lesson.subjectId);
        subjectName = subject?.name ?? "";
        subjectNames.set(lesson.subjectId, subjectName);
      }
      const attendanceRow = await ctx.db
        .query("attendance")
        .withIndex("by_lessonId_and_studentId", (q) =>
          q.eq("lessonId", lesson._id).eq("studentId", studentId),
        )
        .unique();
      todayLessons.push({
        lessonId: lesson._id,
        period: lesson.period,
        subjectName,
        title: lesson.title,
        myStatus: attendanceRow?.status ?? null,
      });
    }

    // Latest 5 submitted results (effective score = override ?? auto).
    const attempts = await ctx.db
      .query("examAttempts")
      .withIndex("by_studentId", (q) => q.eq("studentId", studentId))
      .order("desc")
      .take(100);
    const submitted = attempts.filter(
      (attempt) => attempt.status === "submitted",
    );
    submitted.sort((a, b) => (b.submittedAt ?? 0) - (a.submittedAt ?? 0));
    const recentResults = [];
    for (const attempt of submitted.slice(0, 5)) {
      const exam = await ctx.db.get("exams", attempt.examId);
      if (!exam) continue; // published exams are undeletable; defensive
      recentResults.push({
        examId: attempt.examId,
        title: exam.title,
        score: attempt.overrideScore ?? attempt.autoScore ?? 0,
        maxScore: attempt.maxScore,
        submittedAt: attempt.submittedAt ?? attempt.startedAt,
      });
    }

    // Attendance summary since `from`. Rate counts late as attended —
    // it measures presence, not punctuality.
    const attendanceRows = await ctx.db
      .query("attendance")
      .withIndex("by_studentId_and_date", (q) =>
        q.eq("studentId", studentId).gte("date", args.from),
      )
      .take(300);
    const totals = { present: 0, late: 0, absent: 0 };
    for (const row of attendanceRows) totals[row.status]++;
    const marked = totals.present + totals.late + totals.absent;
    const rate =
      marked === 0
        ? 0
        : Math.round(((totals.present + totals.late) / marked) * 100);

    // M6: points + streak (zeros until the first award lands).
    const gamificationDoc = await ctx.db
      .query("gamification")
      .withIndex("by_studentId", (q) => q.eq("studentId", studentId))
      .unique();

    // Newest 3 teacher notes with author names.
    const noteRows = await ctx.db
      .query("notes")
      .withIndex("by_studentId", (q) => q.eq("studentId", studentId))
      .order("desc")
      .take(3);
    let notes: Array<{
      text: string;
      teacherName: string;
      _creationTime: number;
    }> = [];
    if (noteRows.length > 0) {
      const names = await staffNamesById(ctx);
      notes = noteRows.map((note) => ({
        text: note.text,
        teacherName: names.get(note.teacherId) ?? "",
        _creationTime: note._creationTime,
      }));
    }

    const announcements = await announcementsForStudent(ctx, studentId, 3);

    return {
      student: { firstName: student.firstName, lastName: student.lastName },
      todayLessons,
      recentResults,
      attendance: { ...totals, rate },
      gamification: {
        totalPoints: gamificationDoc?.totalPoints ?? 0,
        streak: gamificationDoc?.streak ?? 0,
      },
      notes,
      announcements,
    };
  },
});

/**
 * The student's own attendance in a date range (newest first) with
 * per-status totals — the portal twin of attendance.historyForStudent.
 */
export const attendanceHistory = query({
  args: { sessionToken: v.string(), from: v.string(), to: v.string() },
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
      late: v.number(),
      absent: v.number(),
    }),
  }),
  handler: async (ctx, args) => {
    const { studentId } = await requireStudentAccount(ctx, args.sessionToken);
    const records = await ctx.db
      .query("attendance")
      .withIndex("by_studentId_and_date", (q) =>
        q
          .eq("studentId", studentId)
          .gte("date", args.from)
          .lte("date", args.to),
      )
      .order("desc")
      .take(300);

    const subjectNames = new Map<Id<"subjects">, string>();
    const totals = { present: 0, late: 0, absent: 0 };
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

/**
 * Class-level stats for one exam, shown on the student's result screen.
 * Gated on the student having a SUBMITTED attempt of their own — before
 * that, even the exam's existence stats must not leak ("not_found").
 */
export const examClassStats = query({
  args: { sessionToken: v.string(), examId: v.id("exams") },
  returns: v.object({
    classAvg: v.number(), // rounded to 1 decimal
    classMax: v.number(),
    submittedCount: v.number(),
    myScore: v.number(),
    maxScore: v.number(),
  }),
  handler: async (ctx, args) => {
    const { studentId } = await requireStudentAccount(ctx, args.sessionToken);
    const myAttempt = await ctx.db
      .query("examAttempts")
      .withIndex("by_examId_and_studentId", (q) =>
        q.eq("examId", args.examId).eq("studentId", studentId),
      )
      .unique();
    if (!myAttempt || myAttempt.status !== "submitted") {
      throw new ConvexError("not_found");
    }

    const attempts = await ctx.db
      .query("examAttempts")
      .withIndex("by_examId", (q) => q.eq("examId", args.examId))
      .take(500);
    const scores: Array<number> = [];
    for (const attempt of attempts) {
      if (attempt.status !== "submitted") continue;
      const effective = attempt.overrideScore ?? attempt.autoScore;
      if (effective !== undefined) scores.push(effective);
    }
    const sum = scores.reduce((total, score) => total + score, 0);
    return {
      classAvg:
        scores.length > 0 ? Math.round((sum / scores.length) * 10) / 10 : 0,
      classMax: scores.length > 0 ? Math.max(...scores) : 0,
      submittedCount: scores.length,
      myScore: myAttempt.overrideScore ?? myAttempt.autoScore ?? 0,
      maxScore: myAttempt.maxScore,
    };
  },
});
