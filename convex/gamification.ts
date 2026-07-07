import { ConvexError, v } from "convex/values";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireAdmin, requireTeacher } from "./auth";
import { requireStudentAccount } from "./studentAuth";
import { assertStaffCanAccessClass } from "./students";
import { logAudit } from "./lib/audit";
import { round2, sumManualScores } from "./lib/grading";
import type { AttendanceStatus } from "./lib/validators";

/**
 * M6 — gamification v1: points + streaks. Points are append-only pointEvents
 * rows deduped by their source row (refType, refId); the running total and
 * the streak live denormalized on one gamification doc per student.
 * Attendance/exam/homework mutations call the exported award helpers; config
 * is an admin-editable settings row ("gamification") shallow-merged over safe
 * defaults. Domain errors use `ConvexError` codes the RTL UI maps to Arabic
 * messages:
 *   invalid_config
 *
 * M10 — levels & badges (pure code, no schema) + progress/leaderboard
 * queries. Badge/level LABELS live in the UI i18n catalog; the server only
 * ever returns stable string ids and numbers.
 */

// ——— Config ———

export type GamificationConfig = {
  presentPoints: number;
  latePoints: number;
  homeworkPoints: number; // M9 — awarded once per homework submission
  examThresholds: Array<{ minPct: number; points: number }>;
};

const DEFAULT_CONFIG: GamificationConfig = {
  presentPoints: 5,
  latePoints: 2,
  homeworkPoints: 5,
  examThresholds: [
    { minPct: 90, points: 20 },
    { minPct: 75, points: 10 },
    { minPct: 50, points: 5 },
  ],
};

const SETTINGS_KEY = "gamification";

const thresholdValidator = v.object({
  minPct: v.number(),
  points: v.number(),
});
const configValidator = v.object({
  presentPoints: v.number(),
  latePoints: v.number(),
  homeworkPoints: v.number(),
  examThresholds: v.array(thresholdValidator),
});

/** A finite, non-negative number — the only shape awards may compute with. */
function isPointsNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * The effective config: the "gamification" settings row shallow-merged onto
 * defaults, field-validated at read (numbers finite and ≥ 0) so a hand-edited
 * row can never produce negative or NaN awards. Thresholds come back sorted
 * desc by minPct, so the first match is always the highest one.
 */
export async function readConfig(ctx: QueryCtx): Promise<GamificationConfig> {
  const row = await ctx.db
    .query("settings")
    .withIndex("by_key", (q) => q.eq("key", SETTINGS_KEY))
    .unique();
  const stored =
    row !== null && typeof row.value === "object" && row.value !== null
      ? (row.value as Record<string, unknown>)
      : {};

  const presentPoints = isPointsNumber(stored.presentPoints)
    ? stored.presentPoints
    : DEFAULT_CONFIG.presentPoints;
  const latePoints = isPointsNumber(stored.latePoints)
    ? stored.latePoints
    : DEFAULT_CONFIG.latePoints;
  const homeworkPoints = isPointsNumber(stored.homeworkPoints)
    ? stored.homeworkPoints
    : DEFAULT_CONFIG.homeworkPoints;

  let examThresholds: GamificationConfig["examThresholds"] = [];
  if (Array.isArray(stored.examThresholds)) {
    for (const raw of stored.examThresholds.slice(0, 5)) {
      const threshold = raw as { minPct?: unknown; points?: unknown } | null;
      const minPct = threshold?.minPct;
      const points = threshold?.points;
      if (isPointsNumber(minPct) && isPointsNumber(points)) {
        examThresholds.push({ minPct, points });
      }
    }
  }
  if (examThresholds.length === 0) {
    examThresholds = [...DEFAULT_CONFIG.examThresholds];
  }
  examThresholds.sort((a, b) => b.minPct - a.minPct);

  return { presentPoints, latePoints, homeworkPoints, examThresholds };
}

/** Admin: the effective gamification config (stored row merged on defaults). */
export const getConfig = query({
  args: {},
  returns: configValidator,
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return await readConfig(ctx);
  },
});

/**
 * Admin: replace the gamification config. Attendance/homework points must be
 * 0–1000; 1–5 exam thresholds, each with minPct 1–100 and points ≥ 0. Stored
 * sorted desc by minPct; audited as "settings.gamification".
 * M9: `homeworkPoints` is optional so pre-M9 callers keep working — when
 * omitted, the currently effective value is preserved.
 */
export const saveConfig = mutation({
  args: {
    presentPoints: v.number(),
    latePoints: v.number(),
    homeworkPoints: v.optional(v.number()),
    examThresholds: v.array(thresholdValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await requireAdmin(ctx);
    if (
      !(args.presentPoints >= 0 && args.presentPoints <= 1000) ||
      !(args.latePoints >= 0 && args.latePoints <= 1000)
    ) {
      throw new ConvexError("invalid_config");
    }
    if (
      args.homeworkPoints !== undefined &&
      !(args.homeworkPoints >= 0 && args.homeworkPoints <= 1000)
    ) {
      throw new ConvexError("invalid_config");
    }
    if (args.examThresholds.length < 1 || args.examThresholds.length > 5) {
      throw new ConvexError("invalid_config");
    }
    for (const threshold of args.examThresholds) {
      if (
        !(threshold.minPct >= 1 && threshold.minPct <= 100) ||
        !(Number.isFinite(threshold.points) && threshold.points >= 0)
      ) {
        throw new ConvexError("invalid_config");
      }
    }

    const value: GamificationConfig = {
      presentPoints: args.presentPoints,
      latePoints: args.latePoints,
      homeworkPoints:
        args.homeworkPoints ?? (await readConfig(ctx)).homeworkPoints,
      examThresholds: [...args.examThresholds].sort(
        (a, b) => b.minPct - a.minPct,
      ),
    };
    const existing = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", SETTINGS_KEY))
      .unique();
    if (existing) {
      await ctx.db.patch("settings", existing._id, { value });
    } else {
      await ctx.db.insert("settings", { key: SETTINGS_KEY, value });
    }
    await logAudit(ctx, {
      actorType: "staff",
      actorId: staff.id,
      action: "settings.gamification",
      targetType: "settings",
      targetId: SETTINGS_KEY,
      meta: value,
    });
    return null;
  },
});

// ——— Award helpers (called from attendance/attempt/exam mutations) ———

/**
 * Append one point event and bump the student's total — exactly once per
 * source row: (refType, refId) is the dedupe key, so re-marking attendance
 * or a double-fired submit hook can never double-award. Creates the
 * student's gamification doc on first award. Returns whether a new event
 * landed.
 */
export async function awardOnce(
  ctx: MutationCtx,
  args: {
    studentId: Id<"students">;
    kind: "attendance" | "exam" | "homework";
    points: number;
    refType: string;
    refId: string;
    day: string;
  },
): Promise<boolean> {
  const existing = await ctx.db
    .query("pointEvents")
    .withIndex("by_refType_and_refId", (q) =>
      q.eq("refType", args.refType).eq("refId", args.refId),
    )
    .first();
  if (existing) return false;
  await ctx.db.insert("pointEvents", {
    studentId: args.studentId,
    kind: args.kind,
    points: args.points,
    refType: args.refType,
    refId: args.refId,
    day: args.day,
  });
  const doc = await ctx.db
    .query("gamification")
    .withIndex("by_studentId", (q) => q.eq("studentId", args.studentId))
    .unique();
  if (doc) {
    await ctx.db.patch("gamification", doc._id, {
      totalPoints: doc.totalPoints + args.points,
    });
  } else {
    await ctx.db.insert("gamification", {
      studentId: args.studentId,
      totalPoints: args.points,
      streak: 0,
    });
  }
  return true;
}

/** Calendar-day index of a "YYYY-MM-DD" key (UTC; keys carry no timezone). */
function dayIndex(dateKey: string): number {
  return (
    Date.UTC(
      Number(dateKey.slice(0, 4)),
      Number(dateKey.slice(5, 7)) - 1,
      Number(dateKey.slice(8, 10)),
    ) / 86_400_000
  );
}

/**
 * Attendance hook: present/late earn the configured points (once per
 * attendance row), then the daily streak advances — at most one bump per
 * calendar day. lastActiveDay only ever moves forward: backdated marking
 * still earns points but never rewinds or resets a streak.
 */
export async function awardForAttendance(
  ctx: MutationCtx,
  args: {
    studentId: Id<"students">;
    attendanceId: Id<"attendance">;
    status: AttendanceStatus;
    date: string; // the lesson's "YYYY-MM-DD" date
  },
): Promise<void> {
  if (args.status !== "present" && args.status !== "late") return;
  const config = await readConfig(ctx);
  await awardOnce(ctx, {
    studentId: args.studentId,
    kind: "attendance",
    points:
      args.status === "present" ? config.presentPoints : config.latePoints,
    refType: "attendance",
    refId: args.attendanceId,
    day: args.date,
  });

  const doc = await ctx.db
    .query("gamification")
    .withIndex("by_studentId", (q) => q.eq("studentId", args.studentId))
    .unique();
  if (!doc) return; // awardOnce just upserted it; defensive
  if (doc.lastActiveDay === args.date) return; // this day already counted
  if (doc.lastActiveDay === undefined) {
    await ctx.db.patch("gamification", doc._id, {
      streak: 1,
      lastActiveDay: args.date,
    });
    return;
  }
  const gap = dayIndex(args.date) - dayIndex(doc.lastActiveDay);
  if (gap <= 0) return; // backdated — points only, streak untouched
  // ponytail: a ≤3-day gap keeps the streak alive — covers the Fri/Sat
  // weekend; upgrade to a school-calendar check if holidays matter.
  await ctx.db.patch("gamification", doc._id, {
    streak: gap <= 3 ? doc.streak + 1 : 1,
    lastActiveDay: args.date,
  });
}

/**
 * Exam hook: the auto score's percentage picks the highest matching
 * threshold; below every threshold earns nothing. Awards use autoScore as
 * finalized at submit/close time.
 * ponytail: awards are immutable — later score overrides don't retro-adjust;
 * revisit if overrides become common.
 */
export async function awardForExam(
  ctx: MutationCtx,
  args: {
    studentId: Id<"students">;
    attemptId: Id<"examAttempts">;
    autoScore: number;
    maxScore: number;
    day: string;
  },
): Promise<void> {
  const pct = args.maxScore > 0 ? (args.autoScore / args.maxScore) * 100 : 0;
  const config = await readConfig(ctx);
  // Sorted desc by minPct — the first match is the highest threshold.
  const matched = config.examThresholds.find((t) => pct >= t.minPct);
  if (!matched) return;
  await awardOnce(ctx, {
    studentId: args.studentId,
    kind: "exam",
    points: matched.points,
    refType: "attempt",
    refId: args.attemptId,
    day: args.day,
  });
}

/**
 * M9 homework hook: the configured flat award for turning a homework in,
 * once per submission row — homework.submit only calls this on the FIRST
 * submission, and awardOnce's (refType, refId) dedupe backstops that. Grades
 * don't affect the award (submitting is the behavior being rewarded).
 */
export async function awardForHomework(
  ctx: MutationCtx,
  args: {
    studentId: Id<"students">;
    submissionId: Id<"homeworkSubmissions">;
    day: string;
  },
): Promise<void> {
  const config = await readConfig(ctx);
  await awardOnce(ctx, {
    studentId: args.studentId,
    kind: "homework",
    points: config.homeworkPoints,
    refType: "submission",
    refId: args.submissionId,
    day: args.day,
  });
}

// ——— M10: levels & badges (pure helpers, no schema) ———

/**
 * Linear leveling: every level costs 100 points. level = 1 + ⌊points/100⌋,
 * pointsIntoLevel = points % 100, and the next level is always 100 away.
 * ponytail: flat 100/level; move the step into the settings config only if
 * tuning ever actually matters.
 */
export function levelFor(points: number): {
  level: number;
  pointsIntoLevel: number;
  nextLevelAt: number;
} {
  const safe = Number.isFinite(points) && points > 0 ? Math.floor(points) : 0;
  return {
    level: 1 + Math.floor(safe / 100),
    pointsIntoLevel: safe % 100,
    nextLevelAt: 100,
  };
}

/**
 * The fixed badge catalog, evaluated over ctx-free inputs. Returns the
 * EARNED badge ids only — labels/icons/descriptions live in the UI i18n
 * catalog, keyed by these stable ids.
 */
export function badgeIdsFor(data: {
  totalPoints: number;
  streak: number;
  perfectExam: boolean;
  homeworkCount: number;
  attendanceCount: number;
}): Array<string> {
  const earned: Array<string> = [];
  if (data.totalPoints >= 100) earned.push("points_100");
  if (data.totalPoints >= 500) earned.push("points_500");
  if (data.totalPoints >= 1000) earned.push("points_1000");
  if (data.streak >= 7) earned.push("streak_7");
  if (data.streak >= 30) earned.push("streak_30");
  if (data.perfectExam) earned.push("perfect_exam");
  if (data.homeworkCount >= 10) earned.push("homework_10");
  if (data.attendanceCount >= 30) earned.push("attendance_30");
  return earned;
}

// ——— M10: leaderboards & progress ———

type StandingRow = {
  studentId: Id<"students">;
  name: string;
  totalPoints: number;
  level: number;
};

const leaderboardRowValidator = v.object({
  rank: v.number(),
  name: v.string(),
  totalPoints: v.number(),
  level: v.number(),
});

const studentLeaderboardRowValidator = v.object({
  rank: v.number(),
  name: v.string(),
  totalPoints: v.number(),
  level: v.number(),
  isMe: v.boolean(),
});

/**
 * A class's active roster joined with gamification docs (students without a
 * doc stand at 0 points), sorted desc by totalPoints. Bounded to 200
 * students — the app-wide class roster cap.
 */
async function classStandings(
  ctx: QueryCtx,
  classId: Id<"classes">,
): Promise<Array<StandingRow>> {
  const enrollments = await ctx.db
    .query("enrollments")
    .withIndex("by_classId_and_active", (q) =>
      q.eq("classId", classId).eq("active", true),
    )
    .take(200);
  const rows: Array<StandingRow> = [];
  for (const enrollment of enrollments) {
    const student = await ctx.db.get("students", enrollment.studentId);
    // Deleted students cascade enrollments; archived students may retain a
    // stray active enrollment (e.g. re-enrolled after archive) — skip both so
    // the class board matches schoolStandings and never leaks archived rows.
    if (!student || student.status === "archived") continue;
    const doc = await ctx.db
      .query("gamification")
      .withIndex("by_studentId", (q) =>
        q.eq("studentId", enrollment.studentId),
      )
      .unique();
    const totalPoints = doc?.totalPoints ?? 0;
    rows.push({
      studentId: enrollment.studentId,
      name: `${student.firstName} ${student.lastName}`,
      totalPoints,
      level: levelFor(totalPoints).level,
    });
  }
  rows.sort((a, b) => b.totalPoints - a.totalPoints);
  return rows;
}

/**
 * School-wide top rows straight off the by_totalPoints index (desc).
 * Archived/deleted students are skipped AFTER the take, so fewer than
 * `limit` rows can come back — acceptable for a top-20 board; bump the take
 * if archived high-scorers ever crowd it out. Exported for
 * analytics.adminOverview (top-5 reuse).
 */
export async function schoolStandings(
  ctx: QueryCtx,
  limit: number,
): Promise<Array<StandingRow>> {
  const docs = await ctx.db
    .query("gamification")
    .withIndex("by_totalPoints")
    .order("desc")
    .take(limit);
  const rows: Array<StandingRow> = [];
  for (const doc of docs) {
    const student = await ctx.db.get("students", doc.studentId);
    if (!student || student.status === "archived") continue;
    rows.push({
      studentId: doc.studentId,
      name: `${student.firstName} ${student.lastName}`,
      totalPoints: doc.totalPoints,
      level: levelFor(doc.totalPoints).level,
    });
  }
  return rows;
}

/**
 * Early-exit probe: does the question set reference ≥1 essay question?
 * Bounded by the set's size. Mirrors attempts.probeHasEssay (not exported
 * there — importing attempts here would create an import cycle). M15:
 * callers pass attempt.questionSet ?? exam.questions so versioned attempts
 * probe their OWN sampled set.
 */
async function setReferencesEssay(
  ctx: QueryCtx,
  questionSet: Array<{ questionId: Id<"questions"> }>,
): Promise<boolean> {
  for (const examQuestion of questionSet) {
    const question = await ctx.db.get("questions", examQuestion.questionId);
    if (question?.type === "essay") return true;
  }
  return false;
}

/**
 * The student's own progress card: points, streak, level, earned badges and
 * class/school ranks. Ranks are positional in the same orderings the
 * leaderboard queries show, so the numbers always agree on screen.
 */
export const myProgress = query({
  args: { sessionToken: v.string() },
  returns: v.object({
    totalPoints: v.number(),
    streak: v.number(),
    level: v.number(),
    pointsIntoLevel: v.number(),
    nextLevelAt: v.number(),
    badges: v.array(v.string()),
    classRank: v.union(v.number(), v.null()),
    classSize: v.number(),
    schoolRank: v.union(v.number(), v.null()),
  }),
  handler: async (ctx, args) => {
    const { studentId } = await requireStudentAccount(ctx, args.sessionToken);
    const doc = await ctx.db
      .query("gamification")
      .withIndex("by_studentId", (q) => q.eq("studentId", studentId))
      .unique();
    const totalPoints = doc?.totalPoints ?? 0;
    const streak = doc?.streak ?? 0;

    // Badge event counts: newest 1000 point events bound the scan — the
    // 10/30 badge thresholds saturate far below the cap, so the only effect
    // of the cap is on students with >1000 events (already all-badged).
    const events = await ctx.db
      .query("pointEvents")
      .withIndex("by_studentId", (q) => q.eq("studentId", studentId))
      .order("desc")
      .take(1000);
    let homeworkCount = 0;
    let attendanceCount = 0;
    for (const event of events) {
      if (event.kind === "homework") homeworkCount++;
      else if (event.kind === "attendance") attendanceCount++;
    }

    // perfect_exam: any FINAL submitted attempt at full marks. Final means
    // gradedAt stamped or essay-free — the portal.examClassStats gate — so a
    // half-graded essay exam can never award the badge early. The cheap
    // score check runs first; the essay probe only fires on candidates.
    const attempts = await ctx.db
      .query("examAttempts")
      .withIndex("by_studentId", (q) => q.eq("studentId", studentId))
      .order("desc")
      .take(200);
    let perfectExam = false;
    const essayByExam = new Map<Id<"exams">, boolean>();
    for (const attempt of attempts) {
      if (attempt.status !== "submitted" || attempt.maxScore <= 0) continue;
      const effective =
        attempt.overrideScore ??
        round2(
          (attempt.autoScore ?? 0) + sumManualScores(attempt.manualScores),
        );
      if (effective !== attempt.maxScore) continue;
      if (attempt.gradedAt === undefined) {
        let referencesEssay: boolean;
        if (attempt.questionSet !== undefined) {
          // M15: versioned attempt — its own sampled set decides (per
          // attempt, so the per-exam cache doesn't apply).
          referencesEssay = await setReferencesEssay(ctx, attempt.questionSet);
        } else {
          let cached = essayByExam.get(attempt.examId);
          if (cached === undefined) {
            const exam = await ctx.db.get("exams", attempt.examId);
            cached = exam
              ? await setReferencesEssay(ctx, exam.questions)
              : false;
            essayByExam.set(attempt.examId, cached);
          }
          referencesEssay = cached;
        }
        if (referencesEssay) continue; // score not final yet
      }
      perfectExam = true;
      break;
    }

    // Class rank among active classmates (first active class, roster ≤200).
    const enrollment = await ctx.db
      .query("enrollments")
      .withIndex("by_studentId_and_active", (q) =>
        q.eq("studentId", studentId).eq("active", true),
      )
      .first();
    let classRank: number | null = null;
    let classSize = 0;
    if (enrollment) {
      const standings = await classStandings(ctx, enrollment.classId);
      classSize = standings.length;
      const index = standings.findIndex((row) => row.studentId === studentId);
      classRank = index >= 0 ? index + 1 : null;
    }

    // School rank straight off the points index. Beyond the top 500 the
    // rank simply isn't shown (null) rather than paying for a deeper scan;
    // a student with no gamification doc yet is also null.
    const top = await ctx.db
      .query("gamification")
      .withIndex("by_totalPoints")
      .order("desc")
      .take(500);
    const schoolIndex = top.findIndex((row) => row.studentId === studentId);
    const schoolRank = schoolIndex >= 0 ? schoolIndex + 1 : null;

    const { level, pointsIntoLevel, nextLevelAt } = levelFor(totalPoints);
    return {
      totalPoints,
      streak,
      level,
      pointsIntoLevel,
      nextLevelAt,
      badges: badgeIdsFor({
        totalPoints,
        streak,
        perfectExam,
        homeworkCount,
        attendanceCount,
      }),
      classRank,
      classSize,
      schoolRank,
    };
  },
});

/**
 * Top 20 of the student's own class (first active class; empty array when
 * not enrolled anywhere). Rows carry isMe so the UI can highlight the
 * caller without ever exposing other students' ids.
 */
export const classLeaderboard = query({
  args: { sessionToken: v.string() },
  returns: v.array(studentLeaderboardRowValidator),
  handler: async (ctx, args) => {
    const { studentId } = await requireStudentAccount(ctx, args.sessionToken);
    const enrollment = await ctx.db
      .query("enrollments")
      .withIndex("by_studentId_and_active", (q) =>
        q.eq("studentId", studentId).eq("active", true),
      )
      .first();
    if (!enrollment) return [];
    const standings = await classStandings(ctx, enrollment.classId);
    return standings.slice(0, 20).map((row, index) => ({
      rank: index + 1,
      name: row.name,
      totalPoints: row.totalPoints,
      level: row.level,
      isMe: row.studentId === studentId,
    }));
  },
});

/** Top 20 of the whole school (archived students skipped). */
export const schoolLeaderboard = query({
  args: { sessionToken: v.string() },
  returns: v.array(studentLeaderboardRowValidator),
  handler: async (ctx, args) => {
    const { studentId } = await requireStudentAccount(ctx, args.sessionToken);
    const standings = await schoolStandings(ctx, 20);
    return standings.map((row, index) => ({
      rank: index + 1,
      name: row.name,
      totalPoints: row.totalPoints,
      level: row.level,
      isMe: row.studentId === studentId,
    }));
  },
});

/** Staff view of one class's top 20 (teacher must be assigned; admin any). */
export const staffClassLeaderboard = query({
  args: { classId: v.id("classes") },
  returns: v.array(leaderboardRowValidator),
  handler: async (ctx, args) => {
    const staff = await requireTeacher(ctx);
    await assertStaffCanAccessClass(ctx, staff, args.classId);
    const standings = await classStandings(ctx, args.classId);
    return standings.slice(0, 20).map((row, index) => ({
      rank: index + 1,
      name: row.name,
      totalPoints: row.totalPoints,
      level: row.level,
    }));
  },
});

/** Staff view of the school-wide top 20. */
export const staffSchoolLeaderboard = query({
  args: {},
  returns: v.array(leaderboardRowValidator),
  handler: async (ctx) => {
    await requireTeacher(ctx);
    const standings = await schoolStandings(ctx, 20);
    return standings.map((row, index) => ({
      rank: index + 1,
      name: row.name,
      totalPoints: row.totalPoints,
      level: row.level,
    }));
  },
});
