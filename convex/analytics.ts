import { v } from "convex/values";
import { query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAdmin, requireTeacher } from "./auth";
import { loadQuestionDocs } from "./exams";
import { schoolStandings } from "./gamification";
import {
  effectiveScore,
  hasEssay,
  isAnswerCorrect,
  questionSetOf,
} from "./lib/grading";
import { assertStaffCanAccessClass } from "./students";

/**
 * M10 — staff analytics. Read-only aggregations for the teacher class
 * dashboard, the per-subject weak-topic report and the admin overview.
 * Every read is index-scoped and bounded; where a cap can drop data the
 * sampling is explicit and commented (never silent). Effective-score rules
 * are the exams.results ones verbatim: effective = override ?? round2(auto +
 * Σ manual), and essay exams only count attempts whose grading completed
 * (gradedAt) so half-graded attempts never skew an average.
 */

/** "YYYY-MM-DD" UTC day key — the convention lessons/pointEvents use. */
function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Chart-label truncation (long Arabic titles crowd axis labels). */
function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

/** Rate of a tally: attended (present+late) over marked, 0–100; 0 if none. */
function rateOf(tally: {
  present: number;
  late: number;
  absent: number;
}): number {
  const marked = tally.present + tally.late + tally.absent;
  return marked === 0
    ? 0
    : Math.round(((tally.present + tally.late) / marked) * 100);
}

/**
 * The class's newest closed-or-published exams: both status index scans
 * (≤50 each — a class sits far below that per term), merged and sorted desc
 * by creation. Drafts never count — they cannot have attempts.
 */
async function recentClassExams(
  ctx: QueryCtx,
  classId: Id<"classes">,
): Promise<Array<Doc<"exams">>> {
  const closed = await ctx.db
    .query("exams")
    .withIndex("by_classId_and_status", (q) =>
      q.eq("classId", classId).eq("status", "closed"),
    )
    .order("desc")
    .take(50);
  const published = await ctx.db
    .query("exams")
    .withIndex("by_classId_and_status", (q) =>
      q.eq("classId", classId).eq("status", "published"),
    )
    .order("desc")
    .take(50);
  return [...closed, ...published].sort(
    (a, b) => b._creationTime - a._creationTime,
  );
}

type ExamStat = {
  avg: number | null; // effective points, 1dp — final attempts only
  avgPct: number | null; // avg as % of totalMarks, integer
  submitted: number; // every submitted attempt, graded or not
};

/**
 * One exam's effective stats over its attempts (take 200 — the class roster
 * cap, and one attempt per student is enforced at start). M15: essay-ness
 * gates finality PER ATTEMPT (versioned attempts carry their own sets); the
 * doc cache shares bank loads across attempts of the exam.
 */
async function examEffectiveStat(
  ctx: QueryCtx,
  exam: Doc<"exams">,
): Promise<ExamStat> {
  const questionDocCache = new Map<string, Doc<"questions">>();
  const attempts = await ctx.db
    .query("examAttempts")
    .withIndex("by_examId", (q) => q.eq("examId", exam._id))
    .take(200);
  let submitted = 0;
  const scores: Array<number> = [];
  for (const attempt of attempts) {
    if (attempt.status !== "submitted") continue;
    submitted++;
    if (attempt.gradedAt === undefined) {
      const questionSet = questionSetOf(attempt, exam);
      const questionDocs = await loadQuestionDocs(
        ctx,
        questionSet,
        questionDocCache,
      );
      if (hasEssay(questionSet, questionDocs)) continue; // not final
    }
    scores.push(effectiveScore(attempt));
  }
  if (scores.length === 0) return { avg: null, avgPct: null, submitted };
  const avg = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  return {
    avg: Math.round(avg * 10) / 10,
    avgPct:
      exam.totalMarks > 0
        ? Math.round((avg / exam.totalMarks) * 100)
        : null,
    submitted,
  };
}

type DayTally = { present: number; late: number; absent: number };

/**
 * Per-date attendance tallies of one class in [from, to], derived through
 * lessons — attendance denormalizes classId/date but has no index on them.
 * Lessons are scanned newest-first and capped at `maxLessons`: past the cap
 * the OLDEST days of the window drop out (explicit sampling; callers pick
 * the cap). Attendance per lesson bounded to 200 (roster cap). Dates whose
 * lessons have no marks never enter the map.
 */
async function attendanceTalliesByDate(
  ctx: QueryCtx,
  classId: Id<"classes">,
  from: string,
  to: string,
  maxLessons: number,
): Promise<Map<string, DayTally>> {
  const lessons = await ctx.db
    .query("lessons")
    .withIndex("by_classId_and_date", (q) =>
      q.eq("classId", classId).gte("date", from).lte("date", to),
    )
    .order("desc")
    .take(maxLessons);
  const tallies = new Map<string, DayTally>();
  for (const lesson of lessons) {
    const rows = await ctx.db
      .query("attendance")
      .withIndex("by_lessonId_and_studentId", (q) =>
        q.eq("lessonId", lesson._id),
      )
      .take(200);
    if (rows.length === 0) continue;
    let tally = tallies.get(lesson.date);
    if (!tally) {
      tally = { present: 0, late: 0, absent: 0 };
      tallies.set(lesson.date, tally);
    }
    for (const row of rows) tally[row.status]++;
  }
  return tallies;
}

/**
 * The teacher's class dashboard in one round trip: last-10 exam averages,
 * a 30-day attendance-rate trend and per-subject exam averages. Teacher
 * must be assigned to the class; admins pass.
 */
export const teacherClassAnalytics = query({
  args: { classId: v.id("classes") },
  returns: v.object({
    examSeries: v.array(
      v.object({
        title: v.string(), // truncated to 30 chars for chart labels
        avg: v.union(v.number(), v.null()), // null until a final score exists
        maxScore: v.number(),
        submitted: v.number(),
      }),
    ),
    attendanceTrend: v.array(
      v.object({ date: v.string(), rate: v.number() }),
    ),
    subjectAverages: v.array(
      v.object({ subjectName: v.string(), avgPct: v.number() }),
    ),
  }),
  handler: async (ctx, args) => {
    const staff = await requireTeacher(ctx);
    await assertStaffCanAccessClass(ctx, staff, args.classId);

    const exams = await recentClassExams(ctx, args.classId);
    // examSeries and subjectAverages overlap on recent exams — memoize the
    // per-exam attempt scans so shared exams are read once.
    const statByExam = new Map<Id<"exams">, ExamStat>();
    const statOf = async (exam: Doc<"exams">): Promise<ExamStat> => {
      let stat = statByExam.get(exam._id);
      if (!stat) {
        stat = await examEffectiveStat(ctx, exam);
        statByExam.set(exam._id, stat);
      }
      return stat;
    };

    // Last 10 exams, chart-ordered oldest → newest.
    const examSeries = [];
    for (const exam of exams.slice(0, 10).reverse()) {
      const stat = await statOf(exam);
      examSeries.push({
        title: truncate(exam.title, 30),
        avg: stat.avg,
        maxScore: exam.totalMarks,
        submitted: stat.submitted,
      });
    }

    // Attendance trend over the last 30 days. 300 lessons cover the full
    // window even at 8 periods/day + ad-hoc extras.
    const now = Date.now();
    const tallies = await attendanceTalliesByDate(
      ctx,
      args.classId,
      dayKey(now - 29 * 86_400_000),
      dayKey(now),
      300,
    );
    const attendanceTrend = [...tallies.entries()]
      .map(([date, tally]) => ({ date, rate: rateOf(tally) }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));

    // Per-subject averages over each subject's newest ≤10 exams. Subjects
    // capped at 10 (a class rarely has more) to bound the attempt scans.
    const assignments = await ctx.db
      .query("teacherAssignments")
      .withIndex("by_classId", (q) => q.eq("classId", args.classId))
      .take(50);
    const subjectIds = [
      ...new Set(assignments.map((assignment) => assignment.subjectId)),
    ].slice(0, 10);
    const subjectAverages = [];
    for (const subjectId of subjectIds) {
      const subjectExams = exams
        .filter((exam) => exam.subjectId === subjectId)
        .slice(0, 10);
      const pcts: Array<number> = [];
      for (const exam of subjectExams) {
        const stat = await statOf(exam);
        if (stat.avgPct !== null) pcts.push(stat.avgPct);
      }
      if (pcts.length === 0) continue; // no final scores yet — omit subject
      const subject = await ctx.db.get("subjects", subjectId);
      subjectAverages.push({
        subjectName: subject?.name ?? "",
        avgPct: Math.round(
          pcts.reduce((sum, pct) => sum + pct, 0) / pcts.length,
        ),
      });
    }

    return { examSeries, attendanceTrend, subjectAverages };
  },
});

/**
 * Weak-topic report for one (class, subject): over the last 10 closed-or-
 * published exams, tally per-topic correctness across every submitted
 * attempt (take 200/exam) and every topic-tagged non-essay question.
 * Correctness is lib/grading.isAnswerCorrect — the exact gradeAnswers rules,
 * with fillblank/matching counting only at full marks (binary tally).
 * Unanswered questions tally as incorrect (a skipped question is signal).
 * Topics need ≥5 samples to appear (noise floor); recommendations are the
 * bottom ≤3 under 60%.
 */
export const weakTopics = query({
  args: { classId: v.id("classes"), subjectId: v.id("subjects") },
  returns: v.object({
    topics: v.array(
      v.object({
        topic: v.string(),
        correct: v.number(),
        total: v.number(),
        pct: v.number(),
      }),
    ),
    recommendations: v.array(
      v.object({ topic: v.string(), subjectName: v.string() }),
    ),
  }),
  handler: async (ctx, args) => {
    const staff = await requireTeacher(ctx);
    await assertStaffCanAccessClass(ctx, staff, args.classId);

    const exams = (await recentClassExams(ctx, args.classId))
      .filter((exam) => exam.subjectId === args.subjectId)
      .slice(0, 10);

    const tally = new Map<string, { correct: number; total: number }>();
    // M15: tallies walk each ATTEMPT'S question set (versioned attempts
    // sample their own); one doc cache spans all exams of the subject.
    const questionDocCache = new Map<string, Doc<"questions">>();
    for (const exam of exams) {
      const attempts = await ctx.db
        .query("examAttempts")
        .withIndex("by_examId", (q) => q.eq("examId", exam._id))
        .take(200);
      for (const attempt of attempts) {
        if (attempt.status !== "submitted") continue;
        const questionSet = questionSetOf(attempt, exam);
        const questionDocs = await loadQuestionDocs(
          ctx,
          questionSet,
          questionDocCache,
        );
        for (const examQuestion of questionSet) {
          const question = questionDocs.get(examQuestion.questionId);
          // Essays are manually graded (no auto-correctness) and untagged
          // questions have no topic to attribute — both excluded.
          if (!question || question.type === "essay") continue;
          const topic = question.topic?.trim();
          if (topic === undefined || topic.length === 0) continue;
          let entry = tally.get(topic);
          if (!entry) {
            entry = { correct: 0, total: 0 };
            tally.set(topic, entry);
          }
          entry.total++;
          if (
            isAnswerCorrect(
              question,
              attempt.answers[examQuestion.questionId],
            )
          ) {
            entry.correct++;
          }
        }
      }
    }

    const topics = [...tally.entries()]
      .filter(([, entry]) => entry.total >= 5)
      .map(([topic, entry]) => ({
        topic,
        correct: entry.correct,
        total: entry.total,
        pct: Math.round((entry.correct / entry.total) * 100),
      }))
      .sort((a, b) => a.pct - b.pct);

    const subject = await ctx.db.get("subjects", args.subjectId);
    const subjectName = subject?.name ?? "";
    const recommendations = topics
      .filter((topic) => topic.pct < 60)
      .slice(0, 3)
      .map((topic) => ({ topic: topic.topic, subjectName }));

    return { topics, recommendations };
  },
});

/**
 * Admin home overview: active-student count, today's attendance, exams
 * whose window started this week, the 30-day school attendance rate and the
 * top-5 leaderboard.
 */
export const adminOverview = query({
  args: {},
  returns: v.object({
    students: v.number(),
    attendanceToday: v.object({
      present: v.number(),
      late: v.number(),
      absent: v.number(),
      rate: v.number(), // 0–100; 0 when nothing marked yet
    }),
    examsThisWeek: v.number(),
    avgAttendanceRate30d: v.number(), // 0–100; 0 when nothing marked
    topStudents: v.array(
      v.object({
        rank: v.number(),
        name: v.string(),
        totalPoints: v.number(),
        level: v.number(),
      }),
    ),
  }),
  handler: async (ctx) => {
    await requireAdmin(ctx);

    // Active students. The take-2000 cap freezes the count there — a single
    // school sits far below it; denormalize a counter before it doesn't.
    const activeStudents = await ctx.db
      .query("students")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .take(2000);

    // Exams whose window started within the last 7 days, over the newest
    // 200 exams by creation (bounded full scan — nowhere near 200/week).
    const now = Date.now();
    const weekAgo = now - 7 * 86_400_000;
    const recentExams = await ctx.db.query("exams").order("desc").take(200);
    const examsThisWeek = recentExams.filter(
      (exam) => exam.windowStart >= weekAgo && exam.windowStart <= now,
    ).length;

    // Attendance (today + 30-day pooled rate), derived through each class's
    // lessons — attendance has no by_date index. Caps: 50 classes × the
    // NEWEST 40 lessons of the window × 200 rows/lesson. The 30d number is
    // therefore a sample biased to recent days for a class running >40
    // lessons/month; today's lessons always land inside the newest-40, so
    // attendanceToday is exact. Move to a denormalized daily tally table if
    // the school outgrows these caps.
    const to = dayKey(now);
    const from = dayKey(now - 29 * 86_400_000);
    const classes = await ctx.db.query("classes").take(50);
    const today: DayTally = { present: 0, late: 0, absent: 0 };
    const window30: DayTally = { present: 0, late: 0, absent: 0 };
    for (const cls of classes) {
      const tallies = await attendanceTalliesByDate(ctx, cls._id, from, to, 40);
      for (const [date, tally] of tallies) {
        window30.present += tally.present;
        window30.late += tally.late;
        window30.absent += tally.absent;
        if (date === to) {
          today.present += tally.present;
          today.late += tally.late;
          today.absent += tally.absent;
        }
      }
    }

    // Top 5 of the exact board gamification.schoolLeaderboard shows.
    const topStudents = (await schoolStandings(ctx, 20))
      .slice(0, 5)
      .map((row, index) => ({
        rank: index + 1,
        name: row.name,
        totalPoints: row.totalPoints,
        level: row.level,
      }));

    return {
      students: activeStudents.length,
      attendanceToday: { ...today, rate: rateOf(today) },
      examsThisWeek,
      avgAttendanceRate30d: rateOf(window30),
      topStudents,
    };
  },
});
