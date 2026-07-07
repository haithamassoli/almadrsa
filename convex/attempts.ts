import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireStudentAccount } from "./studentAuth";
import { loadQuestionDocs } from "./exams";
import { logAudit } from "./lib/audit";
import { gradeAnswers } from "./lib/grading";
import { attemptStatus, questionType } from "./lib/validators";

/**
 * M4 — exam attempts (student/parent portal). Every public function takes
 * the bearer `sessionToken` and resolves it via requireStudentAccount; an
 * attempt is only ever readable/writable by its own student. Answers are
 * merged server-side; grading is server-only.
 *
 * CRITICAL INVARIANT: nothing in this file may ever return
 * `correctOptionId` / `correctBool` — the exam window may still be open.
 *
 * Domain errors use `ConvexError` codes the RTL UI maps to Arabic messages:
 *   not_found · exam_not_open · not_enrolled · attempt_expired
 */

/** Extra time after the deadline during which answer saves still land. */
const SAVE_GRACE_MS = 30_000;

const answersValidator = v.record(
  v.id("questions"),
  v.union(v.string(), v.boolean()),
);

const examState = v.union(
  v.literal("upcoming"),
  v.literal("available"),
  v.literal("in_progress"),
  v.literal("submitted"),
  v.literal("missed"),
);

// ——— Queries ———

/**
 * The student's exam list across their active classes: published + closed
 * exams with a server-derived state and the effective score once submitted.
 * NEVER includes questions — those only flow through getAttempt.
 */
export const listForStudent = query({
  args: { sessionToken: v.string() },
  returns: v.array(
    v.object({
      examId: v.id("exams"),
      title: v.string(),
      subjectName: v.string(),
      windowStart: v.number(),
      windowEnd: v.number(),
      timeLimitMinutes: v.number(),
      totalMarks: v.number(),
      state: examState,
      score: v.optional(v.number()),
      attemptId: v.optional(v.id("examAttempts")),
    }),
  ),
  handler: async (ctx, args) => {
    const { studentId } = await requireStudentAccount(ctx, args.sessionToken);
    const enrollments = await ctx.db
      .query("enrollments")
      .withIndex("by_studentId_and_active", (q) =>
        q.eq("studentId", studentId).eq("active", true),
      )
      .take(20);

    const now = Date.now();
    const subjectNames = new Map<Id<"subjects">, string>();
    const rows: Array<{
      examId: Id<"exams">;
      title: string;
      subjectName: string;
      windowStart: number;
      windowEnd: number;
      timeLimitMinutes: number;
      totalMarks: number;
      state: "upcoming" | "available" | "in_progress" | "submitted" | "missed";
      score?: number;
      attemptId?: Id<"examAttempts">;
    }> = [];
    for (const enrollment of enrollments) {
      const published = await ctx.db
        .query("exams")
        .withIndex("by_classId_and_status", (q) =>
          q.eq("classId", enrollment.classId).eq("status", "published"),
        )
        .take(100);
      const closed = await ctx.db
        .query("exams")
        .withIndex("by_classId_and_status", (q) =>
          q.eq("classId", enrollment.classId).eq("status", "closed"),
        )
        .take(100);

      for (const exam of [...published, ...closed]) {
        const attempt = await ctx.db
          .query("examAttempts")
          .withIndex("by_examId_and_studentId", (q) =>
            q.eq("examId", exam._id).eq("studentId", studentId),
          )
          .unique();

        let state: (typeof rows)[number]["state"];
        let score: number | undefined;
        if (attempt?.status === "submitted") {
          state = "submitted";
          score = attempt.overrideScore ?? attempt.autoScore;
        } else if (attempt) {
          state = "in_progress";
        } else if (exam.status === "closed" || now >= exam.windowEnd) {
          state = "missed";
        } else if (now < exam.windowStart) {
          state = "upcoming";
        } else {
          state = "available";
        }

        let subjectName = subjectNames.get(exam.subjectId);
        if (subjectName === undefined) {
          const subject = await ctx.db.get("subjects", exam.subjectId);
          subjectName = subject?.name ?? "";
          subjectNames.set(exam.subjectId, subjectName);
        }
        rows.push({
          examId: exam._id,
          title: exam.title,
          subjectName,
          windowStart: exam.windowStart,
          windowEnd: exam.windowEnd,
          timeLimitMinutes: exam.timeLimitMinutes,
          totalMarks: exam.totalMarks,
          state,
          score,
          attemptId: attempt?._id,
        });
      }
    }
    rows.sort((a, b) => b.windowStart - a.windowStart);
    return rows;
  },
});

/**
 * One attempt with its exam's questions (exam order) for the taking/review
 * screen. Question options are re-mapped to { id, text } ONLY —
 * correctOptionId/correctBool are stripped ALWAYS, since the window may
 * still be open for other students (and this student's grace period).
 */
export const getAttempt = query({
  args: { sessionToken: v.string(), attemptId: v.id("examAttempts") },
  returns: v.object({
    examTitle: v.string(),
    subjectName: v.optional(v.string()),
    status: attemptStatus,
    startedAt: v.number(),
    deadlineAt: v.number(),
    submittedAt: v.optional(v.number()),
    answers: answersValidator,
    autoScore: v.optional(v.number()),
    overrideScore: v.optional(v.number()),
    maxScore: v.number(),
    totalMarks: v.number(),
    questions: v.array(
      v.object({
        questionId: v.id("questions"),
        type: questionType,
        text: v.string(),
        options: v.array(v.object({ id: v.string(), text: v.string() })),
        marks: v.number(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const { studentId } = await requireStudentAccount(ctx, args.sessionToken);
    const attempt = await ctx.db.get("examAttempts", args.attemptId);
    if (!attempt || attempt.studentId !== studentId) {
      throw new ConvexError("not_found");
    }
    const exam = await ctx.db.get("exams", attempt.examId);
    if (!exam) throw new ConvexError("not_found");
    const subject = await ctx.db.get("subjects", exam.subjectId);

    const questions = [];
    for (const examQuestion of exam.questions) {
      const question = await ctx.db.get("questions", examQuestion.questionId);
      if (!question) continue; // never hard-deleted; defensive
      questions.push({
        questionId: examQuestion.questionId,
        type: question.type,
        text: question.text,
        // Strip everything but id/text — never the correct answer.
        options: question.options.map((option) => ({
          id: option.id,
          text: option.text,
        })),
        marks: examQuestion.marks,
      });
    }

    return {
      examTitle: exam.title,
      subjectName: subject?.name,
      status: attempt.status,
      startedAt: attempt.startedAt,
      deadlineAt: attempt.deadlineAt,
      submittedAt: attempt.submittedAt,
      answers: attempt.answers,
      autoScore: attempt.autoScore,
      overrideScore: attempt.overrideScore,
      maxScore: attempt.maxScore,
      totalMarks: attempt.maxScore,
      questions,
    };
  },
});

// ——— Mutations ———

/**
 * Start (or resume) the student's attempt on a published exam whose window
 * is open. At most one attempt per (exam, student) — an existing one is
 * returned as-is, never duplicated. The per-attempt deadline is
 * min(now + timeLimit, windowEnd) and an auto-submit is scheduled at it.
 */
export const start = mutation({
  args: { sessionToken: v.string(), examId: v.id("exams") },
  returns: v.object({
    attemptId: v.id("examAttempts"),
    deadlineAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const { studentId, accessCodeId } = await requireStudentAccount(
      ctx,
      args.sessionToken,
    );
    const exam = await ctx.db.get("exams", args.examId);
    if (!exam) throw new ConvexError("not_found");
    const now = Date.now();
    if (
      exam.status !== "published" ||
      now < exam.windowStart ||
      now >= exam.windowEnd
    ) {
      throw new ConvexError("exam_not_open");
    }

    const enrollments = await ctx.db
      .query("enrollments")
      .withIndex("by_studentId_and_active", (q) =>
        q.eq("studentId", studentId).eq("active", true),
      )
      .take(20);
    if (!enrollments.some((e) => e.classId === exam.classId)) {
      throw new ConvexError("not_enrolled");
    }

    const existing = await ctx.db
      .query("examAttempts")
      .withIndex("by_examId_and_studentId", (q) =>
        q.eq("examId", args.examId).eq("studentId", studentId),
      )
      .unique();
    if (existing) {
      return { attemptId: existing._id, deadlineAt: existing.deadlineAt };
    }

    const deadlineAt = Math.min(
      now + exam.timeLimitMinutes * 60_000,
      exam.windowEnd,
    );
    const attemptId = await ctx.db.insert("examAttempts", {
      examId: args.examId,
      studentId,
      startedAt: now,
      deadlineAt,
      status: "in_progress",
      answers: {},
      maxScore: exam.totalMarks,
    });
    const expireFnId = await ctx.scheduler.runAt(
      deadlineAt,
      internal.attempts.expire,
      { attemptId },
    );
    await ctx.db.patch("examAttempts", attemptId, { expireFnId });
    await logAudit(ctx, {
      actorType: "student",
      actorId: accessCodeId,
      action: "exam.attempt_start",
      targetType: "examAttempt",
      targetId: attemptId,
      meta: { examId: args.examId },
    });
    return { attemptId, deadlineAt };
  },
});

/**
 * Merge an answers batch into the student's own in-progress attempt.
 * Accepted until deadline + 30s grace (network slack); keys that are not
 * questions of this exam are dropped silently.
 */
export const saveAnswers = mutation({
  args: {
    sessionToken: v.string(),
    attemptId: v.id("examAttempts"),
    answers: answersValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { studentId } = await requireStudentAccount(ctx, args.sessionToken);
    const attempt = await ctx.db.get("examAttempts", args.attemptId);
    if (!attempt || attempt.studentId !== studentId) {
      throw new ConvexError("not_found");
    }
    if (
      attempt.status !== "in_progress" ||
      Date.now() > attempt.deadlineAt + SAVE_GRACE_MS
    ) {
      throw new ConvexError("attempt_expired");
    }
    const exam = await ctx.db.get("exams", attempt.examId);
    if (!exam) throw new ConvexError("not_found");

    const validIds = new Set<string>(
      exam.questions.map((examQuestion) => examQuestion.questionId),
    );
    const cleaned: Record<Id<"questions">, string | boolean> = {};
    for (const [questionId, answer] of Object.entries(args.answers)) {
      if (!validIds.has(questionId)) continue; // drop unknown keys
      cleaned[questionId as Id<"questions">] = answer;
    }
    await ctx.db.patch("examAttempts", args.attemptId, {
      answers: { ...attempt.answers, ...cleaned },
    });
    return null;
  },
});

/**
 * Submit the student's own attempt: grade server-side, stamp submittedAt,
 * cancel the scheduled auto-submit. Idempotent — an already-submitted
 * attempt returns its stored scores unchanged.
 */
export const submit = mutation({
  args: { sessionToken: v.string(), attemptId: v.id("examAttempts") },
  returns: v.object({
    autoScore: v.number(),
    maxScore: v.number(),
    overrideScore: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    const { studentId, accessCodeId } = await requireStudentAccount(
      ctx,
      args.sessionToken,
    );
    const attempt = await ctx.db.get("examAttempts", args.attemptId);
    if (!attempt || attempt.studentId !== studentId) {
      throw new ConvexError("not_found");
    }
    if (attempt.status === "submitted") {
      return {
        autoScore: attempt.autoScore ?? 0,
        maxScore: attempt.maxScore,
        overrideScore: attempt.overrideScore,
      };
    }

    const exam = await ctx.db.get("exams", attempt.examId);
    let autoScore = 0;
    if (exam) {
      const questionDocs = await loadQuestionDocs(ctx, exam.questions);
      autoScore = gradeAnswers(exam.questions, questionDocs, attempt.answers);
    }
    await ctx.db.patch("examAttempts", args.attemptId, {
      status: "submitted",
      submittedAt: Date.now(),
      autoScore,
      expireFnId: undefined,
    });
    if (attempt.expireFnId !== undefined) {
      await ctx.scheduler.cancel(attempt.expireFnId);
    }
    await logAudit(ctx, {
      actorType: "student",
      actorId: accessCodeId,
      action: "exam.attempt_submit",
      targetType: "examAttempt",
      targetId: args.attemptId,
      meta: { examId: attempt.examId, autoScore },
    });
    return {
      autoScore,
      maxScore: attempt.maxScore,
      overrideScore: attempt.overrideScore,
    };
  },
});

/**
 * Scheduled at deadlineAt by start: auto-submit an attempt that is still
 * in progress, grading whatever answers were saved (no grace). Idempotent —
 * a manual submit before it fires makes this a no-op.
 */
export const expire = internalMutation({
  args: { attemptId: v.id("examAttempts") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const attempt = await ctx.db.get("examAttempts", args.attemptId);
    if (!attempt || attempt.status !== "in_progress") return null;
    const exam = await ctx.db.get("exams", attempt.examId);
    let autoScore = 0;
    if (exam) {
      const questionDocs = await loadQuestionDocs(ctx, exam.questions);
      autoScore = gradeAnswers(exam.questions, questionDocs, attempt.answers);
    }
    await ctx.db.patch("examAttempts", args.attemptId, {
      status: "submitted",
      submittedAt: Date.now(),
      autoScore,
      expireFnId: undefined,
    });
    return null;
  },
});
