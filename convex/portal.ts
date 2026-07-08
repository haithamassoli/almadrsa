import { ConvexError, v } from "convex/values";
import { query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireStudentAccount } from "./studentAuth";
import {
  announcementsForStudent,
  studentAnnouncementValidator,
} from "./announcements";
import { staffNamesById } from "./notes";
import { loadQuestionDocs } from "./exams";
import { weekdayOf } from "./lib/dates";
import {
  effectiveScore,
  hasEssay,
  isAnswerCorrect,
  questionSetOf,
} from "./lib/grading";
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

    // M8: essay attempts withhold scores (mine and the class's) until
    // grading completes — an ungraded attempt neither sees stats nor
    // deflates them with its auto-only score. M15: essay-ness is per
    // ATTEMPT (versioned attempts sample their own question sets); the doc
    // cache shares bank loads across the class's attempts.
    const exam = await ctx.db.get("exams", args.examId);
    const questionDocCache = new Map<string, Doc<"questions">>();
    const effectiveOf = async (
      attempt: Doc<"examAttempts">,
    ): Promise<number | undefined> => {
      if (attempt.status !== "submitted") return undefined;
      if (attempt.gradedAt === undefined && exam) {
        const questionSet = questionSetOf(attempt, exam);
        const questionDocs = await loadQuestionDocs(
          ctx,
          questionSet,
          questionDocCache,
        );
        if (hasEssay(questionSet, questionDocs)) return undefined;
      }
      return effectiveScore(attempt);
    };

    const myScore = await effectiveOf(myAttempt);
    if (myScore === undefined) {
      // My essay attempt is still being graded — no stats yet.
      throw new ConvexError("not_found");
    }

    const attempts = await ctx.db
      .query("examAttempts")
      .withIndex("by_examId", (q) => q.eq("examId", args.examId))
      .take(500);
    const scores: Array<number> = [];
    for (const attempt of attempts) {
      const effective = await effectiveOf(attempt);
      if (effective !== undefined) scores.push(effective);
    }
    const sum = scores.reduce((total, score) => total + score, 0);
    return {
      classAvg:
        scores.length > 0 ? Math.round((sum / scores.length) * 10) / 10 : 0,
      classMax: scores.length > 0 ? Math.max(...scores) : 0,
      submittedCount: scores.length,
      myScore,
      maxScore: myAttempt.maxScore,
    };
  },
});

/** Chart-label truncation (long Arabic exam titles crowd axis labels). */
function truncateLabel(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

/**
 * M10 — the student's own analytics screen in one round trip. Everything
 * derives from the caller's OWN rows; the only cross-student numbers are
 * per-exam class averages over exams the student themselves took — the same
 * aggregate examClassStats already exposes per exam, never per student.
 *
 * "Graded" attempt = submitted with a FINAL score: essay-free, or every
 * essay manually graded (gradedAt) — the examClassStats gate. Effective
 * score = override ?? round2(auto + Σ manual); pct is over the attempt's
 * frozen maxScore.
 *
 * [from, to] are "YYYY-MM-DD" keys and scope ONLY attendanceByWeekday; exam
 * numbers use the student's whole (bounded) attempt history.
 */
export const studentAnalytics = query({
  args: { sessionToken: v.string(), from: v.string(), to: v.string() },
  returns: v.object({
    subjectComparison: v.array(
      v.object({
        subjectName: v.string(),
        myAvgPct: v.number(), // 1dp, 0–100
        classAvgPct: v.number(), // 1dp, 0–100
      }),
    ),
    scoreTrend: v.array(
      v.object({ label: v.string(), pct: v.number() }), // oldest → newest
    ),
    attendanceByWeekday: v.array(
      v.object({
        weekday: v.number(), // 0=Sunday … 4=Thursday (school week)
        present: v.number(),
        late: v.number(),
        absent: v.number(),
      }),
    ),
    weakTopics: v.array(
      v.object({
        topic: v.string(),
        subjectName: v.string(),
        pct: v.number(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const { studentId } = await requireStudentAccount(ctx, args.sessionToken);

    // ——— Own graded attempts, newest first. The scan reads the newest 200
    // attempts; the newest 50 SUBMITTED ones are considered further — this
    // cap bounds the per-exam class-average scans below and comfortably
    // covers a school year of exams. ———
    const attempts = await ctx.db
      .query("examAttempts")
      .withIndex("by_studentId", (q) => q.eq("studentId", studentId))
      .order("desc")
      .take(200);
    const submitted = attempts
      .filter((attempt) => attempt.status === "submitted")
      .sort((a, b) => (b.submittedAt ?? 0) - (a.submittedAt ?? 0))
      .slice(0, 50);

    const examCache = new Map<Id<"exams">, Doc<"exams"> | null>();
    // M15: question sets are per ATTEMPT (versioned exams sample per
    // student) — one flat doc cache spans every set touched below.
    const questionDocCache = new Map<string, Doc<"questions">>();
    const docsOf = async (
      questionSet: Array<{ questionId: Id<"questions">; marks: number }>,
    ): Promise<Map<string, Doc<"questions">>> =>
      await loadQuestionDocs(ctx, questionSet, questionDocCache);

    type GradedAttempt = {
      attempt: Doc<"examAttempts">;
      exam: Doc<"exams">;
      pct: number; // 1dp
    };
    const graded: Array<GradedAttempt> = [];
    for (const attempt of submitted) {
      let exam = examCache.get(attempt.examId);
      if (exam === undefined) {
        exam = await ctx.db.get("exams", attempt.examId);
        examCache.set(attempt.examId, exam);
      }
      if (!exam || attempt.maxScore <= 0) continue; // defensive
      if (attempt.gradedAt === undefined) {
        const questionSet = questionSetOf(attempt, exam);
        if (hasEssay(questionSet, await docsOf(questionSet))) {
          continue; // essay attempt still being graded — score not final
        }
      }
      const effective = effectiveScore(attempt);
      graded.push({
        attempt,
        exam,
        pct: Math.round((effective / attempt.maxScore) * 1000) / 10,
      });
    }

    // ——— Score trend: newest 10 graded attempts, chronological. ———
    const scoreTrend = graded
      .slice(0, 10)
      .map((entry) => ({
        label: truncateLabel(entry.exam.title, 20),
        pct: entry.pct,
      }))
      .reverse();

    // ——— Subject comparison. Class average per exam pools the pcts of
    // every FINAL submitted attempt (take 200/exam — roster cap, one
    // attempt per student); each exam then weighs equally per subject, the
    // same weighting the student's own average gets (one attempt = one
    // exam). Computed once per distinct exam. ———
    const classAvgByExam = new Map<Id<"exams">, number | null>();
    const classAvgOf = async (entry: GradedAttempt): Promise<number | null> => {
      const cached = classAvgByExam.get(entry.exam._id);
      if (cached !== undefined) return cached;
      const rows = await ctx.db
        .query("examAttempts")
        .withIndex("by_examId", (q) => q.eq("examId", entry.exam._id))
        .take(200);
      const pcts: Array<number> = [];
      for (const row of rows) {
        if (row.status !== "submitted" || row.maxScore <= 0) continue;
        if (row.gradedAt === undefined) {
          // M15: finality is per attempt — each row's own question set.
          const rowSet = questionSetOf(row, entry.exam);
          if (hasEssay(rowSet, await docsOf(rowSet))) continue;
        }
        const effective = effectiveScore(row);
        pcts.push((effective / row.maxScore) * 100);
      }
      const avg =
        pcts.length > 0
          ? pcts.reduce((sum, pct) => sum + pct, 0) / pcts.length
          : null;
      classAvgByExam.set(entry.exam._id, avg);
      return avg;
    };

    const bySubject = new Map<
      Id<"subjects">,
      { my: Array<number>; cls: Array<number> }
    >();
    for (const entry of graded) {
      let bucket = bySubject.get(entry.exam.subjectId);
      if (!bucket) {
        bucket = { my: [], cls: [] };
        bySubject.set(entry.exam.subjectId, bucket);
      }
      bucket.my.push(entry.pct);
      const classAvg = await classAvgOf(entry);
      if (classAvg !== null) bucket.cls.push(classAvg);
    }
    const subjectNames = new Map<Id<"subjects">, string>();
    const subjectNameOf = async (
      subjectId: Id<"subjects">,
    ): Promise<string> => {
      let name = subjectNames.get(subjectId);
      if (name === undefined) {
        const subject = await ctx.db.get("subjects", subjectId);
        name = subject?.name ?? "";
        subjectNames.set(subjectId, name);
      }
      return name;
    };
    const mean = (values: Array<number>): number =>
      values.reduce((sum, value) => sum + value, 0) / values.length;
    const subjectComparison = [];
    for (const [subjectId, bucket] of bySubject) {
      subjectComparison.push({
        subjectName: await subjectNameOf(subjectId),
        myAvgPct: Math.round(mean(bucket.my) * 10) / 10,
        classAvgPct:
          bucket.cls.length > 0 ? Math.round(mean(bucket.cls) * 10) / 10 : 0,
      });
    }

    // ——— Attendance by weekday over [from, to] (take 300 — matches the
    // portal history bound). School week is Sun–Thu; Fri/Sat rows (odd
    // ad-hoc lessons) are skipped. ———
    const attendanceRows = await ctx.db
      .query("attendance")
      .withIndex("by_studentId_and_date", (q) =>
        q
          .eq("studentId", studentId)
          .gte("date", args.from)
          .lte("date", args.to),
      )
      .take(300);
    const attendanceByWeekday = [0, 1, 2, 3, 4].map((weekday) => ({
      weekday,
      present: 0,
      late: 0,
      absent: 0,
    }));
    for (const row of attendanceRows) {
      const weekday = weekdayOf(row.date);
      if (weekday > 4) continue;
      attendanceByWeekday[weekday][row.status]++;
    }

    // ——— Own weak topics over the newest ≤20 graded attempts. Correctness
    // is lib/grading.isAnswerCorrect (the gradeAnswers rules; fillblank/
    // matching count only at full marks — binary tally). Unanswered tallies
    // as incorrect; essays and untagged questions are excluded. Topics are
    // keyed per subject — the same topic name in two subjects is two
    // topics. ———
    const topicTally = new Map<
      string,
      { topic: string; subjectId: Id<"subjects">; correct: number; total: number }
    >();
    for (const entry of graded.slice(0, 20)) {
      // M15: tally the attempt's OWN question set (versioned exams).
      const questionSet = questionSetOf(entry.attempt, entry.exam);
      const docs = await docsOf(questionSet);
      for (const examQuestion of questionSet) {
        const question = docs.get(examQuestion.questionId);
        if (!question || question.type === "essay") continue;
        const topic = question.topic?.trim();
        if (topic === undefined || topic.length === 0) continue;
        const key = `${entry.exam.subjectId}:${topic}`;
        let tally = topicTally.get(key);
        if (!tally) {
          tally = {
            topic,
            subjectId: entry.exam.subjectId,
            correct: 0,
            total: 0,
          };
          topicTally.set(key, tally);
        }
        tally.total++;
        if (
          isAnswerCorrect(question, entry.attempt.answers[examQuestion.questionId])
        ) {
          tally.correct++;
        }
      }
    }
    const weakCandidates = [...topicTally.values()]
      .filter((tally) => tally.total >= 3)
      .map((tally) => ({
        topic: tally.topic,
        subjectId: tally.subjectId,
        pct: Math.round((tally.correct / tally.total) * 100),
      }))
      .filter((tally) => tally.pct < 60)
      .sort((a, b) => a.pct - b.pct)
      .slice(0, 3);
    const weakTopics = [];
    for (const candidate of weakCandidates) {
      weakTopics.push({
        topic: candidate.topic,
        subjectName: await subjectNameOf(candidate.subjectId),
        pct: candidate.pct,
      });
    }

    return { subjectComparison, scoreTrend, attendanceByWeekday, weakTopics };
  },
});
