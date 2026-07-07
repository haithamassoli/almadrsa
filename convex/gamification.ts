import { ConvexError, v } from "convex/values";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireAdmin } from "./auth";
import { logAudit } from "./lib/audit";
import type { AttendanceStatus } from "./lib/validators";

/**
 * M6 — gamification v1: points + streaks. Points are append-only pointEvents
 * rows deduped by their source row (refType, refId); the running total and
 * the streak live denormalized on one gamification doc per student.
 * Attendance/exam mutations call the exported award helpers; config is an
 * admin-editable settings row ("gamification") shallow-merged over safe
 * defaults. Domain errors use `ConvexError` codes the RTL UI maps to Arabic
 * messages:
 *   invalid_config
 */

// ——— Config ———

export type GamificationConfig = {
  presentPoints: number;
  latePoints: number;
  examThresholds: Array<{ minPct: number; points: number }>;
};

const DEFAULT_CONFIG: GamificationConfig = {
  presentPoints: 5,
  latePoints: 2,
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

  return { presentPoints, latePoints, examThresholds };
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
 * Admin: replace the gamification config. Attendance points must be 0–1000;
 * 1–5 exam thresholds, each with minPct 1–100 and points ≥ 0. Stored sorted
 * desc by minPct; audited as "settings.gamification".
 */
export const saveConfig = mutation({
  args: {
    presentPoints: v.number(),
    latePoints: v.number(),
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
    kind: "attendance" | "exam";
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
