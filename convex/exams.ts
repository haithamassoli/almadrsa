import { ConvexError, v } from "convex/values";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireTeacher, type StaffUser } from "./auth";
import { logAudit } from "./lib/audit";
import { gradeAnswers } from "./lib/grading";
import { difficulty, examStatus, questionType } from "./lib/validators";

/**
 * M4 — exams (staff side). An exam is a titled, marked selection of bank
 * questions for one (class, subject), with an availability window and a per-
 * attempt time limit. Lifecycle: draft (editable) → published (students may
 * attempt; auto-close scheduled at windowEnd) → closed (sweep auto-submits
 * stragglers). Owner-or-admin on every function. Domain errors use
 * `ConvexError` codes the RTL UI maps to Arabic messages:
 *   not_found · not_assigned · invalid_exam · exam_not_editable
 *   window_past · exam_not_published · not_submitted · invalid_score
 */

const examQuestionValidator = v.object({
  questionId: v.id("questions"),
  marks: v.number(),
});

/** Shared arg fields of create/update (update makes them all optional). */
const examCreateFields = {
  title: v.string(),
  classId: v.id("classes"),
  subjectId: v.id("subjects"),
  questions: v.array(examQuestionValidator),
  windowStart: v.number(),
  windowEnd: v.number(),
  timeLimitMinutes: v.number(),
};
const examUpdateFields = {
  title: v.optional(v.string()),
  classId: v.optional(v.id("classes")),
  subjectId: v.optional(v.id("subjects")),
  questions: v.optional(v.array(examQuestionValidator)),
  windowStart: v.optional(v.number()),
  windowEnd: v.optional(v.number()),
  timeLimitMinutes: v.optional(v.number()),
};

// ——— Shared helpers ———

/**
 * Load an exam the caller may act on: admins any, teachers only their own.
 * Missing and not-owned both throw "not_found" so existence never leaks.
 */
async function requireExamOwner(
  ctx: QueryCtx,
  staff: StaffUser,
  examId: Id<"exams">,
): Promise<Doc<"exams">> {
  const exam = await ctx.db.get("exams", examId);
  if (!exam || (staff.role !== "admin" && exam.teacherId !== staff.id)) {
    throw new ConvexError("not_found");
  }
  return exam;
}

/**
 * Load the question docs an exam references, once, keyed by question id.
 * Shared with convex/attempts.ts (grading at submit/expire).
 */
export async function loadQuestionDocs(
  ctx: QueryCtx,
  examQuestions: Array<{ questionId: Id<"questions">; marks: number }>,
): Promise<Map<string, Doc<"questions">>> {
  const docs = new Map<string, Doc<"questions">>();
  for (const examQuestion of examQuestions) {
    if (docs.has(examQuestion.questionId)) continue;
    const doc = await ctx.db.get("questions", examQuestion.questionId);
    if (doc) docs.set(examQuestion.questionId, doc);
  }
  return docs;
}

type ExamPayload = {
  title: string;
  classId: Id<"classes">;
  subjectId: Id<"subjects">;
  questions: Array<{ questionId: Id<"questions">; marks: number }>;
  windowStart: number;
  windowEnd: number;
  timeLimitMinutes: number;
};

/**
 * Shared create/update validation. Teachers need the (subject, class)
 * assignment ("not_assigned"); every other violation is "invalid_exam":
 * empty title, windowStart ≥ windowEnd, non-integer or out-of-range time
 * limit, 0 or >100 questions, marks outside (0, 100], duplicate questions
 * (answers are keyed by questionId — a duplicate could only ever hold one
 * answer yet would be graded twice), and questions that are missing,
 * archived or from another subject. Returns the trimmed title + totalMarks.
 */
async function validateExamPayload(
  ctx: QueryCtx,
  staff: StaffUser,
  input: ExamPayload,
): Promise<{ title: string; totalMarks: number }> {
  if (staff.role !== "admin") {
    const assignments = await ctx.db
      .query("teacherAssignments")
      .withIndex("by_subjectId_and_classId", (q) =>
        q.eq("subjectId", input.subjectId).eq("classId", input.classId),
      )
      .take(10);
    if (!assignments.some((a) => a.teacherId === staff.id)) {
      throw new ConvexError("not_assigned");
    }
  }

  const title = input.title.trim();
  if (title.length === 0) throw new ConvexError("invalid_exam");
  if (
    !Number.isFinite(input.windowStart) ||
    !Number.isFinite(input.windowEnd) ||
    input.windowStart >= input.windowEnd
  ) {
    throw new ConvexError("invalid_exam");
  }
  if (
    !Number.isInteger(input.timeLimitMinutes) ||
    input.timeLimitMinutes < 1 ||
    input.timeLimitMinutes > 300
  ) {
    throw new ConvexError("invalid_exam");
  }
  if (input.questions.length < 1 || input.questions.length > 100) {
    throw new ConvexError("invalid_exam");
  }

  const seen = new Set<string>();
  let totalMarks = 0;
  for (const examQuestion of input.questions) {
    if (!(examQuestion.marks > 0) || examQuestion.marks > 100) {
      throw new ConvexError("invalid_exam");
    }
    if (seen.has(examQuestion.questionId)) {
      throw new ConvexError("invalid_exam");
    }
    seen.add(examQuestion.questionId);
    const question = await ctx.db.get("questions", examQuestion.questionId);
    if (
      !question ||
      question.archived ||
      question.subjectId !== input.subjectId
    ) {
      throw new ConvexError("invalid_exam");
    }
    totalMarks += examQuestion.marks;
  }
  return { title, totalMarks };
}

/**
 * Idempotent close: mark the exam closed and auto-submit every in-progress
 * attempt with its current answers graded (question docs loaded once).
 * Shared by closeNow and the scheduled closeExam.
 */
async function closeSweep(
  ctx: MutationCtx,
  exam: Doc<"exams">,
): Promise<void> {
  await ctx.db.patch("exams", exam._id, {
    status: "closed",
    closeFnId: undefined,
  });
  const attempts = await ctx.db
    .query("examAttempts")
    .withIndex("by_examId", (q) => q.eq("examId", exam._id))
    .take(500);
  const inProgress = attempts.filter((a) => a.status === "in_progress");
  if (inProgress.length === 0) return;

  const questionDocs = await loadQuestionDocs(ctx, exam.questions);
  const now = Date.now();
  for (const attempt of inProgress) {
    const autoScore = gradeAnswers(
      exam.questions,
      questionDocs,
      attempt.answers,
    );
    await ctx.db.patch("examAttempts", attempt._id, {
      status: "submitted",
      submittedAt: now,
      autoScore,
      expireFnId: undefined,
    });
    if (attempt.expireFnId !== undefined) {
      await ctx.scheduler.cancel(attempt.expireFnId);
    }
  }
}

/** Cached class/subject name lookups for bounded join loops. */
async function cachedName<Table extends "classes" | "subjects">(
  ctx: QueryCtx,
  table: Table,
  id: Id<Table>,
  cache: Map<Id<Table>, string>,
): Promise<string> {
  const cached = cache.get(id);
  if (cached !== undefined) return cached;
  // Classes and subjects both carry `name: string`; TS cannot reduce the
  // generic indexed access to that, hence the contained cast.
  const doc = (await ctx.db.get(table, id)) as { name: string } | null;
  const name = doc?.name ?? "";
  cache.set(id, name);
  return name;
}

// ——— Queries ———

/**
 * The caller's exams (admin: all exams), newest first, with joined names and
 * how many attempts are already submitted.
 */
export const listMine = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("exams"),
      title: v.string(),
      className: v.string(),
      subjectName: v.string(),
      status: examStatus,
      windowStart: v.number(),
      windowEnd: v.number(),
      timeLimitMinutes: v.number(),
      totalMarks: v.number(),
      submittedCount: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const staff = await requireTeacher(ctx);
    const exams =
      staff.role === "admin"
        ? await ctx.db.query("exams").order("desc").take(200)
        : await ctx.db
            .query("exams")
            .withIndex("by_teacherId", (q) => q.eq("teacherId", staff.id))
            .order("desc")
            .take(200);

    const classNames = new Map<Id<"classes">, string>();
    const subjectNames = new Map<Id<"subjects">, string>();
    const result = [];
    for (const exam of exams) {
      const attempts = await ctx.db
        .query("examAttempts")
        .withIndex("by_examId", (q) => q.eq("examId", exam._id))
        .take(500);
      let submittedCount = 0;
      for (const attempt of attempts) {
        if (attempt.status === "submitted") submittedCount++;
      }
      result.push({
        _id: exam._id,
        title: exam.title,
        className: await cachedName(ctx, "classes", exam.classId, classNames),
        subjectName: await cachedName(
          ctx,
          "subjects",
          exam.subjectId,
          subjectNames,
        ),
        status: exam.status,
        windowStart: exam.windowStart,
        windowEnd: exam.windowEnd,
        timeLimitMinutes: exam.timeLimitMinutes,
        totalMarks: exam.totalMarks,
        submittedCount,
      });
    }
    return result;
  },
});

/**
 * Full exam detail for the builder/detail page (owner-or-admin): the exam
 * with its question docs joined in exam order, correct answers included
 * (staff-gated — students go through attempts.getAttempt which strips them).
 */
export const get = query({
  args: { examId: v.id("exams") },
  returns: v.object({
    _id: v.id("exams"),
    title: v.string(),
    teacherId: v.string(),
    classId: v.id("classes"),
    subjectId: v.id("subjects"),
    className: v.string(),
    subjectName: v.string(),
    status: examStatus,
    windowStart: v.number(),
    windowEnd: v.number(),
    timeLimitMinutes: v.number(),
    totalMarks: v.number(),
    questions: v.array(
      v.object({
        questionId: v.id("questions"),
        marks: v.number(),
        type: questionType,
        text: v.string(),
        options: v.array(v.object({ id: v.string(), text: v.string() })),
        correctOptionId: v.optional(v.string()),
        correctBool: v.optional(v.boolean()),
        topic: v.optional(v.string()),
        difficulty: difficulty,
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const staff = await requireTeacher(ctx);
    const exam = await requireExamOwner(ctx, staff, args.examId);
    const cls = await ctx.db.get("classes", exam.classId);
    const subject = await ctx.db.get("subjects", exam.subjectId);

    const questions = [];
    for (const examQuestion of exam.questions) {
      const question = await ctx.db.get("questions", examQuestion.questionId);
      if (!question) continue; // questions are never hard-deleted; defensive
      questions.push({
        questionId: examQuestion.questionId,
        marks: examQuestion.marks,
        type: question.type,
        text: question.text,
        options: question.options,
        correctOptionId: question.correctOptionId,
        correctBool: question.correctBool,
        topic: question.topic,
        difficulty: question.difficulty,
      });
    }

    return {
      _id: exam._id,
      title: exam.title,
      teacherId: exam.teacherId,
      classId: exam.classId,
      subjectId: exam.subjectId,
      className: cls?.name ?? "",
      subjectName: subject?.name ?? "",
      status: exam.status,
      windowStart: exam.windowStart,
      windowEnd: exam.windowEnd,
      timeLimitMinutes: exam.timeLimitMinutes,
      totalMarks: exam.totalMarks,
      questions,
    };
  },
});

/**
 * Marking overview (owner-or-admin): the class's active roster LEFT JOINed
 * with this exam's attempts, plus stats over submitted effective scores.
 */
export const results = query({
  args: { examId: v.id("exams") },
  returns: v.object({
    rows: v.array(
      v.object({
        studentId: v.id("students"),
        studentName: v.string(),
        attemptId: v.optional(v.id("examAttempts")),
        status: v.union(
          v.literal("not_started"),
          v.literal("in_progress"),
          v.literal("submitted"),
        ),
        autoScore: v.optional(v.number()),
        overrideScore: v.optional(v.number()),
        effectiveScore: v.optional(v.number()),
        submittedAt: v.optional(v.number()),
      }),
    ),
    stats: v.object({
      submitted: v.number(),
      enrolled: v.number(),
      avg: v.union(v.number(), v.null()),
      max: v.union(v.number(), v.null()),
      min: v.union(v.number(), v.null()),
    }),
  }),
  handler: async (ctx, args) => {
    const staff = await requireTeacher(ctx);
    const exam = await requireExamOwner(ctx, staff, args.examId);

    const attempts = await ctx.db
      .query("examAttempts")
      .withIndex("by_examId", (q) => q.eq("examId", exam._id))
      .take(500);
    const attemptByStudent = new Map<Id<"students">, Doc<"examAttempts">>();
    for (const attempt of attempts) {
      attemptByStudent.set(attempt.studentId, attempt);
    }

    const enrollments = await ctx.db
      .query("enrollments")
      .withIndex("by_classId_and_active", (q) =>
        q.eq("classId", exam.classId).eq("active", true),
      )
      .take(500);

    const rows: Array<{
      studentId: Id<"students">;
      studentName: string;
      attemptId?: Id<"examAttempts">;
      status: "not_started" | "in_progress" | "submitted";
      autoScore?: number;
      overrideScore?: number;
      effectiveScore?: number;
      submittedAt?: number;
    }> = [];
    const effectiveScores: Array<number> = [];
    for (const enrollment of enrollments) {
      const student = await ctx.db.get("students", enrollment.studentId);
      if (!student) continue;
      const attempt = attemptByStudent.get(enrollment.studentId);
      const row: (typeof rows)[number] = {
        studentId: student._id,
        studentName: `${student.firstName} ${student.lastName}`,
        status: attempt?.status ?? "not_started",
      };
      if (attempt) {
        row.attemptId = attempt._id;
        row.autoScore = attempt.autoScore;
        row.overrideScore = attempt.overrideScore;
        row.submittedAt = attempt.submittedAt;
        if (attempt.status === "submitted") {
          const effective = attempt.overrideScore ?? attempt.autoScore;
          row.effectiveScore = effective;
          if (effective !== undefined) effectiveScores.push(effective);
        }
      }
      rows.push(row);
    }
    rows.sort((a, b) =>
      a.studentName < b.studentName ? -1 : a.studentName > b.studentName ? 1 : 0,
    );

    const submitted = rows.filter((r) => r.status === "submitted").length;
    const stats = {
      submitted,
      enrolled: rows.length,
      avg:
        effectiveScores.length > 0
          ? effectiveScores.reduce((sum, s) => sum + s, 0) /
            effectiveScores.length
          : null,
      max: effectiveScores.length > 0 ? Math.max(...effectiveScores) : null,
      min: effectiveScores.length > 0 ? Math.min(...effectiveScores) : null,
    };
    return { rows, stats };
  },
});

// ——— Mutations ———

/** Create a draft exam for a (class, subject) the caller teaches. */
export const create = mutation({
  args: examCreateFields,
  returns: v.id("exams"),
  handler: async (ctx, args) => {
    const staff = await requireTeacher(ctx);
    const { title, totalMarks } = await validateExamPayload(ctx, staff, args);
    const examId = await ctx.db.insert("exams", {
      title,
      teacherId: staff.id,
      classId: args.classId,
      subjectId: args.subjectId,
      questions: args.questions,
      windowStart: args.windowStart,
      windowEnd: args.windowEnd,
      timeLimitMinutes: args.timeLimitMinutes,
      status: "draft",
      totalMarks,
    });
    await logAudit(ctx, {
      actorType: "staff",
      actorId: staff.id,
      action: "exam.create",
      targetType: "exam",
      targetId: examId,
      meta: {
        classId: args.classId,
        subjectId: args.subjectId,
        questionCount: args.questions.length,
        totalMarks,
      },
    });
    return examId;
  },
});

/**
 * Edit a DRAFT exam (owner-or-admin). Partial args merge over the stored
 * exam, then the merged result is revalidated exactly like create and
 * totalMarks recomputed.
 */
export const update = mutation({
  args: { examId: v.id("exams"), ...examUpdateFields },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await requireTeacher(ctx);
    const exam = await requireExamOwner(ctx, staff, args.examId);
    if (exam.status !== "draft") throw new ConvexError("exam_not_editable");
    const effective: ExamPayload = {
      title: args.title ?? exam.title,
      classId: args.classId ?? exam.classId,
      subjectId: args.subjectId ?? exam.subjectId,
      questions: args.questions ?? exam.questions,
      windowStart: args.windowStart ?? exam.windowStart,
      windowEnd: args.windowEnd ?? exam.windowEnd,
      timeLimitMinutes: args.timeLimitMinutes ?? exam.timeLimitMinutes,
    };
    const { title, totalMarks } = await validateExamPayload(
      ctx,
      staff,
      effective,
    );
    await ctx.db.patch("exams", args.examId, {
      title,
      classId: effective.classId,
      subjectId: effective.subjectId,
      questions: effective.questions,
      windowStart: effective.windowStart,
      windowEnd: effective.windowEnd,
      timeLimitMinutes: effective.timeLimitMinutes,
      totalMarks,
    });
    return null;
  },
});

/** Delete a DRAFT exam (owner-or-admin). Published exams close instead. */
export const remove = mutation({
  args: { examId: v.id("exams") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await requireTeacher(ctx);
    const exam = await requireExamOwner(ctx, staff, args.examId);
    if (exam.status !== "draft") throw new ConvexError("exam_not_editable");
    await ctx.db.delete("exams", args.examId);
    await logAudit(ctx, {
      actorType: "staff",
      actorId: staff.id,
      action: "exam.delete",
      targetType: "exam",
      targetId: args.examId,
      meta: {
        title: exam.title,
        classId: exam.classId,
        subjectId: exam.subjectId,
      },
    });
    return null;
  },
});

/**
 * Publish a draft (owner-or-admin): students may attempt once the window
 * opens; an auto-close is scheduled at windowEnd. Refused when the window
 * already ended ("window_past").
 */
export const publish = mutation({
  args: { examId: v.id("exams") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await requireTeacher(ctx);
    const exam = await requireExamOwner(ctx, staff, args.examId);
    if (exam.status !== "draft") throw new ConvexError("exam_not_editable");
    if (exam.windowEnd <= Date.now()) throw new ConvexError("window_past");
    const closeFnId = await ctx.scheduler.runAt(
      exam.windowEnd,
      internal.exams.closeExam,
      { examId: args.examId },
    );
    await ctx.db.patch("exams", args.examId, {
      status: "published",
      closeFnId,
    });
    await logAudit(ctx, {
      actorType: "staff",
      actorId: staff.id,
      action: "exam.publish",
      targetType: "exam",
      targetId: args.examId,
      meta: { windowStart: exam.windowStart, windowEnd: exam.windowEnd },
    });
    return null;
  },
});

/**
 * Close a published exam early (owner-or-admin): cancels the scheduled
 * auto-close and runs the same close sweep it would have run.
 */
export const closeNow = mutation({
  args: { examId: v.id("exams") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await requireTeacher(ctx);
    const exam = await requireExamOwner(ctx, staff, args.examId);
    if (exam.status !== "published") {
      throw new ConvexError("exam_not_published");
    }
    if (exam.closeFnId !== undefined) {
      await ctx.scheduler.cancel(exam.closeFnId);
    }
    await closeSweep(ctx, exam);
    await logAudit(ctx, {
      actorType: "staff",
      actorId: staff.id,
      action: "exam.close",
      targetType: "exam",
      targetId: args.examId,
    });
    return null;
  },
});

/** Scheduled at windowEnd by publish. Idempotent (no-op unless published). */
export const closeExam = internalMutation({
  args: { examId: v.id("exams") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const exam = await ctx.db.get("exams", args.examId);
    if (!exam || exam.status !== "published") return null;
    await closeSweep(ctx, exam);
    return null;
  },
});

/**
 * Manual score override on a SUBMITTED attempt (owner-or-admin), clamped to
 * [0, maxScore]. Audited with old/new values and the optional reason.
 */
export const overrideScore = mutation({
  args: {
    attemptId: v.id("examAttempts"),
    score: v.number(),
    reason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await requireTeacher(ctx);
    const attempt = await ctx.db.get("examAttempts", args.attemptId);
    if (!attempt) throw new ConvexError("not_found");
    await requireExamOwner(ctx, staff, attempt.examId);
    if (attempt.status !== "submitted") {
      throw new ConvexError("not_submitted");
    }
    if (!(args.score >= 0) || args.score > attempt.maxScore) {
      throw new ConvexError("invalid_score");
    }
    await ctx.db.patch("examAttempts", args.attemptId, {
      overrideScore: args.score,
      overrideBy: staff.id,
      overrideAt: Date.now(),
    });
    await logAudit(ctx, {
      actorType: "staff",
      actorId: staff.id,
      action: "exam.override_score",
      targetType: "examAttempt",
      targetId: args.attemptId,
      meta: {
        old: attempt.overrideScore ?? attempt.autoScore,
        new: args.score,
        reason: args.reason,
      },
    });
    return null;
  },
});
