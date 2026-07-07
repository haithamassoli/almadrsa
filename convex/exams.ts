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
import { awardForExam } from "./gamification";
import { logAudit } from "./lib/audit";
import {
  gradeAnswers,
  hasEssay,
  questionSetOf,
  round2,
  splitScores,
  sumManualScores,
} from "./lib/grading";
import { formatDateAr, notifyClass, notifyStudents } from "./lib/notify";
import {
  attemptStatus,
  difficulty,
  examStatus,
  questionType,
  type Difficulty,
} from "./lib/validators";
import {
  blankValidator,
  itemValidator,
  optionValidator,
  pairValidator,
} from "./questions";

/**
 * M4/M8 — exams (staff side). An exam is a titled, marked selection of bank
 * questions for one (class, subject), with an availability window and a per-
 * attempt time limit. Lifecycle: draft (editable) → published (students may
 * attempt; auto-close scheduled at windowEnd) → closed (sweep auto-submits
 * stragglers). Owner-or-admin on every function.
 *
 * M8 manual grading: an exam with ≥1 essay question withholds results until
 * every essay of the attempt has a manual score (gradedAt stamp) — submit/
 * expire/close send a "received" notification instead of the score, and the
 * gamification award is deferred to grading completion (exams.gradeEssay).
 *
 * M15 unique versions: an exam with versionRules samples a per-student
 * questionSet from the subject's bank at attempt start — exam.questions is
 * then only a fallback preview. Every read of an attempt's questions goes
 * through lib/grading.questionSetOf(attempt, exam).
 *
 * Domain errors use `ConvexError` codes the RTL UI maps to Arabic messages:
 *   not_found · not_assigned · invalid_exam · exam_not_editable
 *   window_past · exam_not_published · not_submitted · invalid_score
 *   invalid_grading · insufficient_bank
 */

const examQuestionValidator = v.object({
  questionId: v.id("questions"),
  marks: v.number(),
});

// M15 — one sampling rule of a version-ruled exam. count (1–50 integer) and
// marksEach ((0, 100]) are range-checked in validateExamPayload.
export const versionRuleValidator = v.object({
  topic: v.optional(v.string()), // exact bank-topic match when set
  difficulty: v.optional(difficulty), // bank-difficulty match when set
  count: v.number(),
  marksEach: v.number(),
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
  shuffle: v.optional(v.boolean()), // undefined ⇒ true
  versionRules: v.optional(v.array(versionRuleValidator)), // [] ⇒ none
  noBacktrack: v.optional(v.boolean()), // undefined ⇒ false
};
const examUpdateFields = {
  title: v.optional(v.string()),
  classId: v.optional(v.id("classes")),
  subjectId: v.optional(v.id("subjects")),
  questions: v.optional(v.array(examQuestionValidator)),
  windowStart: v.optional(v.number()),
  windowEnd: v.optional(v.number()),
  timeLimitMinutes: v.optional(v.number()),
  shuffle: v.optional(v.boolean()),
  versionRules: v.optional(v.array(versionRuleValidator)), // [] clears
  noBacktrack: v.optional(v.boolean()),
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
 * Load the question docs a question set references, once, keyed by question
 * id. Shared with convex/attempts.ts (grading at submit/expire). M15: pass a
 * `cache` map to share loads across ATTEMPTS of the same exam (versioned
 * attempts overlap heavily on the same bank pool); the returned map may then
 * hold extra entries — every caller only ever looks up its own set's ids.
 */
export async function loadQuestionDocs(
  ctx: QueryCtx,
  examQuestions: Array<{ questionId: Id<"questions">; marks: number }>,
  cache?: Map<string, Doc<"questions">>,
): Promise<Map<string, Doc<"questions">>> {
  const docs = cache ?? new Map<string, Doc<"questions">>();
  for (const examQuestion of examQuestions) {
    if (docs.has(examQuestion.questionId)) continue;
    const doc = await ctx.db.get("questions", examQuestion.questionId);
    if (doc) docs.set(examQuestion.questionId, doc);
  }
  return docs;
}

// ——— M15: version-rule helpers (shared with convex/attempts.ts) ———

export type VersionRule = {
  topic?: string;
  difficulty?: Difficulty;
  count: number;
  marksEach: number;
};

/** One rule's bank filter: topic exact (when set), difficulty (when set). */
export function ruleMatches(
  question: Doc<"questions">,
  rule: { topic?: string; difficulty?: Difficulty },
): boolean {
  if (rule.topic !== undefined && question.topic !== rule.topic) return false;
  if (
    rule.difficulty !== undefined &&
    question.difficulty !== rule.difficulty
  ) {
    return false;
  }
  return true;
}

/**
 * The subject's question bank — the base pool version rules validate and
 * sample against. Bounded to 500 rows like questions.list, so a bank beyond
 * the cap contributes only the same 500 the bank screen shows.
 */
export async function loadSubjectBank(
  ctx: QueryCtx,
  subjectId: Id<"subjects">,
): Promise<Array<Doc<"questions">>> {
  return await ctx.db
    .query("questions")
    .withIndex("by_subjectId", (q) => q.eq("subjectId", subjectId))
    .take(500);
}

type ExamPayload = {
  title: string;
  classId: Id<"classes">;
  subjectId: Id<"subjects">;
  questions: Array<{ questionId: Id<"questions">; marks: number }>;
  windowStart: number;
  windowEnd: number;
  timeLimitMinutes: number;
  versionRules?: Array<VersionRule>;
};

/**
 * Shared create/update validation. Teachers need the (subject, class)
 * assignment ("not_assigned"); every other violation is "invalid_exam":
 * empty title, windowStart ≥ windowEnd, non-integer or out-of-range time
 * limit, 0 or >100 questions, marks outside (0, 100], duplicate questions
 * (answers are keyed by questionId — a duplicate could only ever hold one
 * answer yet would be graded twice), and questions that are missing,
 * archived or from another subject.
 *
 * M15 versionRules (when present, [] counts as absent): 1–10 rules, each
 * with an integer count 1–50 and marksEach in (0, 100]; topics trimmed
 * (empty ⇒ any topic). totalMarks then becomes Σ count·marksEach — the
 * fixed questions list stays validated as the fallback preview. Returns the
 * trimmed title, totalMarks and the normalized rules.
 */
async function validateExamPayload(
  ctx: QueryCtx,
  staff: StaffUser,
  input: ExamPayload,
): Promise<{
  title: string;
  totalMarks: number;
  versionRules: Array<VersionRule> | undefined;
}> {
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

  // M15 — version rules ([] normalizes to "no rules", like empty payload
  // arrays elsewhere). Bank sufficiency is checked at PUBLISH, not here —
  // drafts may be written before the bank is filled.
  let versionRules: Array<VersionRule> | undefined;
  if (input.versionRules !== undefined && input.versionRules.length > 0) {
    if (input.versionRules.length > 10) throw new ConvexError("invalid_exam");
    versionRules = input.versionRules.map((rule) => {
      if (
        !Number.isInteger(rule.count) ||
        rule.count < 1 ||
        rule.count > 50 ||
        !(rule.marksEach > 0) ||
        rule.marksEach > 100
      ) {
        throw new ConvexError("invalid_exam");
      }
      const topic = rule.topic?.trim();
      return {
        topic: topic !== undefined && topic.length > 0 ? topic : undefined,
        difficulty: rule.difficulty,
        count: rule.count,
        marksEach: rule.marksEach,
      };
    });
    // Versioned totalMarks — every attempt's sampled set sums to exactly
    // this by construction (count questions at marksEach per rule).
    totalMarks = round2(
      versionRules.reduce((sum, rule) => sum + rule.count * rule.marksEach, 0),
    );
  }
  return { title, totalMarks, versionRules };
}

/**
 * Idempotent close: mark the exam closed and auto-submit every in-progress
 * attempt with its current answers graded (question docs loaded once per
 * distinct question via the shared cache). Shared by closeNow and the
 * scheduled closeExam.
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

  // M15: versioned attempts each grade against their OWN sampled set — the
  // doc cache shares bank loads across attempts (heavy pool overlap).
  const questionDocCache = new Map<string, Doc<"questions">>();
  const now = Date.now();
  // M6: swept auto-submissions earn exam points too (UTC day key — same
  // convention as attempts.submit).
  const day = new Date(now).toISOString().slice(0, 10);
  for (const attempt of inProgress) {
    const questionSet = questionSetOf(attempt, exam);
    const questionDocs = await loadQuestionDocs(
      ctx,
      questionSet,
      questionDocCache,
    );
    // M8: essay attempts withhold results — the score is only final once
    // every essay is manually graded, so the sweep sends a "received" note
    // and the gamification award is deferred to completion (gradeEssay).
    const attemptHasEssay = hasEssay(questionSet, questionDocs);
    const autoScore = gradeAnswers(questionSet, questionDocs, attempt.answers);
    await ctx.db.patch("examAttempts", attempt._id, {
      status: "submitted",
      submittedAt: now,
      autoScore,
      expireFnId: undefined,
    });
    if (attempt.expireFnId !== undefined) {
      await ctx.scheduler.cancel(attempt.expireFnId);
    }
    if (attemptHasEssay) {
      await notifyStudents(ctx, [attempt.studentId], {
        type: "result",
        title: `استلمنا إجاباتك: ${exam.title}`,
        body: "ستصلك النتيجة بعد اكتمال التصحيح",
        refType: "exam",
        refId: exam._id,
      });
      continue;
    }
    // M6: award exam points on the swept auto score.
    await awardForExam(ctx, {
      studentId: attempt.studentId,
      attemptId: attempt._id,
      autoScore,
      maxScore: attempt.maxScore,
      day,
    });
    // M5: the sweep just made this attempt's result final — notify.
    await notifyStudents(ctx, [attempt.studentId], {
      type: "result",
      title: `ظهرت نتيجتك: ${exam.title}`,
      body: `${autoScore}/${attempt.maxScore}`,
      refType: "exam",
      refId: exam._id,
    });
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
    shuffle: v.optional(v.boolean()), // undefined ⇒ true
    versionRules: v.optional(v.array(versionRuleValidator)), // M15
    noBacktrack: v.optional(v.boolean()), // M15, undefined ⇒ false
    questions: v.array(
      v.object({
        questionId: v.id("questions"),
        marks: v.number(),
        type: questionType,
        text: v.string(),
        options: v.array(optionValidator),
        correctOptionId: v.optional(v.string()),
        correctBool: v.optional(v.boolean()),
        blanks: v.optional(v.array(blankValidator)),
        pairs: v.optional(v.array(pairValidator)),
        items: v.optional(v.array(itemValidator)),
        rubricText: v.optional(v.string()),
        imageId: v.optional(v.id("_storage")),
        imageUrl: v.optional(v.string()),
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
        blanks: question.blanks,
        pairs: question.pairs,
        items: question.items,
        rubricText: question.rubricText,
        imageId: question.imageId,
        imageUrl:
          question.imageId !== undefined
            ? ((await ctx.storage.getUrl(question.imageId)) ?? undefined)
            : undefined,
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
      shuffle: exam.shuffle,
      versionRules: exam.versionRules,
      noBacktrack: exam.noBacktrack,
      questions,
    };
  },
});

/**
 * Marking overview (owner-or-admin): the class's active roster LEFT JOINed
 * with this exam's attempts, plus stats over submitted effective scores.
 * M8: effectiveScore = override ?? (autoScore + Σ manualScores); rows carry
 * gradingPending (essay attempt, not yet fully graded) and stats only count
 * fully-graded (or essay-free) submitted attempts. M15: essay-ness is per
 * ATTEMPT (versioned attempts sample their own sets) and rows carry the
 * focus-loss counter logged while taking.
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
        gradingPending: v.boolean(),
        submittedAt: v.optional(v.number()),
        focusLossCount: v.optional(v.number()), // M15 integrity signal
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
    const questionDocCache = new Map<string, Doc<"questions">>();

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
      gradingPending: boolean;
      submittedAt?: number;
      focusLossCount?: number;
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
        gradingPending: false,
      };
      if (attempt) {
        row.attemptId = attempt._id;
        row.autoScore = attempt.autoScore;
        row.overrideScore = attempt.overrideScore;
        row.submittedAt = attempt.submittedAt;
        row.focusLossCount = attempt.focusLossCount;
        if (attempt.status === "submitted") {
          // M15: per-attempt essay check — the attempt's own question set.
          const questionSet = questionSetOf(attempt, exam);
          const questionDocs = await loadQuestionDocs(
            ctx,
            questionSet,
            questionDocCache,
          );
          const attemptHasEssay = hasEssay(questionSet, questionDocs);
          row.gradingPending =
            attemptHasEssay && attempt.gradedAt === undefined;
          const effective =
            attempt.overrideScore ??
            round2(
              (attempt.autoScore ?? 0) + sumManualScores(attempt.manualScores),
            );
          row.effectiveScore = effective;
          // Stats only over final scores: fully graded or essay-free.
          if (!row.gradingPending) effectiveScores.push(effective);
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

/** The essay question ids of a question set, in set order. */
function essayQuestionIds(
  questionSet: Array<{ questionId: Id<"questions">; marks: number }>,
  questionDocs: Map<string, Doc<"questions">>,
): Array<Id<"questions">> {
  return questionSet
    .map((examQuestion) => examQuestion.questionId)
    .filter((questionId) => questionDocs.get(questionId)?.type === "essay");
}

/**
 * M8 — the exam's manual-grading worklist (owner-or-admin): submitted
 * attempts still awaiting grading (≥1 essay, no gradedAt stamp), oldest
 * submission first. Empty for essay-free exams. M15: essays are counted per
 * ATTEMPT — a versioned attempt may hold essays even when the exam's
 * fallback question list has none (and vice versa).
 */
export const gradingQueue = query({
  args: { examId: v.id("exams") },
  returns: v.array(
    v.object({
      attemptId: v.id("examAttempts"),
      studentName: v.string(),
      submittedAt: v.optional(v.number()),
      essayCount: v.number(),
      gradedCount: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const staff = await requireTeacher(ctx);
    const exam = await requireExamOwner(ctx, staff, args.examId);
    const questionDocCache = new Map<string, Doc<"questions">>();

    const attempts = await ctx.db
      .query("examAttempts")
      .withIndex("by_examId", (q) => q.eq("examId", exam._id))
      .take(500);
    const rows = [];
    for (const attempt of attempts) {
      if (attempt.status !== "submitted" || attempt.gradedAt !== undefined) {
        continue;
      }
      const questionSet = questionSetOf(attempt, exam);
      const questionDocs = await loadQuestionDocs(
        ctx,
        questionSet,
        questionDocCache,
      );
      const essayIds = essayQuestionIds(questionSet, questionDocs);
      if (essayIds.length === 0) continue; // essay-free attempt — final
      const student = await ctx.db.get("students", attempt.studentId);
      rows.push({
        attemptId: attempt._id,
        studentName: student
          ? `${student.firstName} ${student.lastName}`
          : "",
        submittedAt: attempt.submittedAt,
        essayCount: essayIds.length,
        gradedCount: essayIds.filter(
          (questionId) => attempt.manualScores?.[questionId] !== undefined,
        ).length,
      });
    }
    rows.sort((a, b) => (a.submittedAt ?? 0) - (b.submittedAt ?? 0));
    return rows;
  },
});

/**
 * M8 — one attempt prepared for the grading screen (owner-or-admin, resolved
 * through the attempt's exam): every essay question with the student's text,
 * the rubric, current score/feedback, plus the attempt's non-essay auto
 * summary (autoScore over autoMarks; essays are worth essayMarks).
 */
export const attemptForGrading = query({
  args: { attemptId: v.id("examAttempts") },
  returns: v.object({
    attemptId: v.id("examAttempts"),
    examId: v.id("exams"),
    examTitle: v.string(),
    studentName: v.string(),
    status: attemptStatus,
    submittedAt: v.optional(v.number()),
    gradedAt: v.optional(v.number()),
    maxScore: v.number(),
    autoScore: v.optional(v.number()), // non-essay part (essays grade 0)
    autoMarks: v.number(),
    essayMarks: v.number(),
    essays: v.array(
      v.object({
        questionId: v.id("questions"),
        text: v.string(),
        rubricText: v.optional(v.string()),
        imageUrl: v.optional(v.string()),
        marks: v.number(),
        studentAnswer: v.union(v.string(), v.null()),
        currentScore: v.optional(v.number()),
        currentFeedback: v.object({
          text: v.optional(v.string()),
          audioUrl: v.optional(v.string()),
        }),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const staff = await requireTeacher(ctx);
    const attempt = await ctx.db.get("examAttempts", args.attemptId);
    if (!attempt) throw new ConvexError("not_found");
    const exam = await requireExamOwner(ctx, staff, attempt.examId);
    const student = await ctx.db.get("students", attempt.studentId);
    // M15: grade against the attempt's OWN question set (versioned exams).
    const questionSet = questionSetOf(attempt, exam);
    const questionDocs = await loadQuestionDocs(ctx, questionSet);
    const { autoMarks, essayMarks } = splitScores(questionSet, questionDocs);

    const essays = [];
    for (const examQuestion of questionSet) {
      const question = questionDocs.get(examQuestion.questionId);
      if (!question || question.type !== "essay") continue;
      const answer = attempt.answers[examQuestion.questionId];
      const feedback = attempt.feedback?.[examQuestion.questionId];
      essays.push({
        questionId: examQuestion.questionId,
        text: question.text,
        rubricText: question.rubricText,
        imageUrl:
          question.imageId !== undefined
            ? ((await ctx.storage.getUrl(question.imageId)) ?? undefined)
            : undefined,
        marks: examQuestion.marks,
        studentAnswer: typeof answer === "string" ? answer : null,
        currentScore: attempt.manualScores?.[examQuestion.questionId],
        currentFeedback: {
          text: feedback?.text,
          audioUrl:
            feedback?.audioId !== undefined
              ? ((await ctx.storage.getUrl(feedback.audioId)) ?? undefined)
              : undefined,
        },
      });
    }

    return {
      attemptId: attempt._id,
      examId: exam._id,
      examTitle: exam.title,
      studentName: student
        ? `${student.firstName} ${student.lastName}`
        : "",
      status: attempt.status,
      submittedAt: attempt.submittedAt,
      gradedAt: attempt.gradedAt,
      maxScore: attempt.maxScore,
      autoScore: attempt.autoScore,
      autoMarks,
      essayMarks,
      essays,
    };
  },
});

// ——— Mutations ———

/** Create a draft exam for a (class, subject) the caller teaches. */
export const create = mutation({
  args: examCreateFields,
  returns: v.id("exams"),
  handler: async (ctx, args) => {
    const staff = await requireTeacher(ctx);
    const { title, totalMarks, versionRules } = await validateExamPayload(
      ctx,
      staff,
      args,
    );
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
      shuffle: args.shuffle, // undefined ⇒ true
      versionRules, // M15 — per-student versions when set
      noBacktrack: args.noBacktrack, // M15 — undefined ⇒ false
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
        versionRuleCount: versionRules?.length,
        totalMarks,
      },
    });
    return examId;
  },
});

/**
 * Edit a DRAFT exam (owner-or-admin). Partial args merge over the stored
 * exam, then the merged result is revalidated exactly like create and
 * totalMarks recomputed. M15: versionRules is tri-state — omitted keeps the
 * stored rules, `[]` clears them (back to a fixed-questions exam).
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
      versionRules: args.versionRules ?? exam.versionRules,
    };
    const { title, totalMarks, versionRules } = await validateExamPayload(
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
      shuffle: args.shuffle ?? exam.shuffle,
      versionRules, // undefined clears ([] normalized there)
      noBacktrack: args.noBacktrack ?? exam.noBacktrack,
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
 *
 * M15 — version-ruled exams additionally need a big-enough bank BEFORE any
 * student can start: per rule enough matching non-archived subject questions
 * (essays allowed — they just queue for manual grading), and enough DISTINCT
 * questions across all rules together (pools may overlap; attempts sample
 * without replacement across the whole set). Failure is the bare code
 * "insufficient_bank" — no counts leak.
 */
export const publish = mutation({
  args: { examId: v.id("exams") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await requireTeacher(ctx);
    const exam = await requireExamOwner(ctx, staff, args.examId);
    if (exam.status !== "draft") throw new ConvexError("exam_not_editable");
    if (exam.windowEnd <= Date.now()) throw new ConvexError("window_past");
    if (exam.versionRules !== undefined && exam.versionRules.length > 0) {
      const bank = await loadSubjectBank(ctx, exam.subjectId);
      const active = bank.filter((question) => !question.archived);
      const distinct = new Set<string>();
      let required = 0;
      for (const rule of exam.versionRules) {
        const pool = active.filter((question) => ruleMatches(question, rule));
        if (pool.length < rule.count) {
          throw new ConvexError("insufficient_bank");
        }
        for (const question of pool) distinct.add(question._id);
        required += rule.count;
      }
      if (distinct.size < required) {
        throw new ConvexError("insufficient_bank");
      }
    }
    const closeFnId = await ctx.scheduler.runAt(
      exam.windowEnd,
      internal.exams.closeExam,
      { examId: args.examId },
    );
    await ctx.db.patch("exams", args.examId, {
      status: "published",
      closeFnId,
    });
    // M5: tell the class a new exam is available. Dates only (Arabic month
    // names, Latin digits) — exact local times render client-side.
    const startDay = formatDateAr(exam.windowStart);
    const endDay = formatDateAr(exam.windowEnd);
    await notifyClass(ctx, exam.classId, {
      type: "exam_published",
      title: `اختبار جديد: ${exam.title}`,
      body:
        startDay === endDay
          ? `متاح يوم ${startDay}`
          : `متاح من ${startDay} حتى ${endDay}`,
      refType: "exam",
      refId: args.examId,
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

const MAX_FEEDBACK_TEXT_LENGTH = 2000;

/**
 * M8 — grade one essay answer of a SUBMITTED attempt (owner-or-admin):
 * merge the manual score (0 ≤ score ≤ that question's frozen marks) and the
 * optional feedback (text and/or a voice-note storage id). When the merge
 * completes the LAST ungraded essay of the exam, the attempt is stamped
 * gradedAt/gradedBy, the student is notified with the combined total
 * (auto + Σ manual), and the deferred gamification award fires — exactly
 * once, since awardOnce dedupes on the attempt id. Re-grading after
 * completion adjusts scores silently (use overrideScore to notify a
 * correction).
 *
 * Feedback merge semantics: an omitted feedbackText/feedbackAudioId keeps
 * the existing value; feedbackText of only whitespace clears the text.
 */
export const gradeEssay = mutation({
  args: {
    attemptId: v.id("examAttempts"),
    questionId: v.id("questions"),
    score: v.number(), // range-checked below: finite, 0 ≤ score ≤ marks
    feedbackText: v.optional(v.string()),
    feedbackAudioId: v.optional(v.id("_storage")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await requireTeacher(ctx);
    const attempt = await ctx.db.get("examAttempts", args.attemptId);
    if (!attempt) throw new ConvexError("not_found");
    const exam = await requireExamOwner(ctx, staff, attempt.examId);
    if (attempt.status !== "submitted") {
      throw new ConvexError("not_submitted");
    }

    // The question must be an ESSAY question OF THIS ATTEMPT'S set (M15:
    // versioned attempts hold their own sampled marks).
    const attemptQuestionSet = questionSetOf(attempt, exam);
    const examQuestion = attemptQuestionSet.find(
      (q) => q.questionId === args.questionId,
    );
    if (!examQuestion) throw new ConvexError("invalid_grading");
    const question = await ctx.db.get("questions", args.questionId);
    if (!question || question.type !== "essay") {
      throw new ConvexError("invalid_grading");
    }
    if (
      !Number.isFinite(args.score) ||
      args.score < 0 ||
      args.score > examQuestion.marks
    ) {
      throw new ConvexError("invalid_score");
    }
    if (
      args.feedbackText !== undefined &&
      args.feedbackText.length > MAX_FEEDBACK_TEXT_LENGTH
    ) {
      throw new ConvexError("invalid_grading");
    }

    const manualScores: Record<Id<"questions">, number> = {
      ...(attempt.manualScores ?? {}),
      [args.questionId]: args.score,
    };
    const existingFeedback = attempt.feedback?.[args.questionId];
    const feedbackTextTrimmed = args.feedbackText?.trim();
    const mergedEntry = {
      text:
        args.feedbackText === undefined
          ? existingFeedback?.text
          : feedbackTextTrimmed !== undefined && feedbackTextTrimmed.length > 0
            ? feedbackTextTrimmed
            : undefined,
      audioId: args.feedbackAudioId ?? existingFeedback?.audioId,
    };
    const feedback = {
      ...(attempt.feedback ?? {}),
      [args.questionId]: mergedEntry,
    };
    await ctx.db.patch("examAttempts", args.attemptId, {
      manualScores,
      feedback,
    });
    await logAudit(ctx, {
      actorType: "staff",
      actorId: staff.id,
      action: "exam.grade_essay",
      targetType: "examAttempt",
      targetId: args.attemptId,
      meta: { questionId: args.questionId, score: args.score },
    });

    // Completion check: every essay question of the ATTEMPT'S set now has a
    // manual score, and this is the FIRST completion (gradedAt not stamped).
    const questionDocs = await loadQuestionDocs(ctx, attemptQuestionSet);
    const essayIds = essayQuestionIds(attemptQuestionSet, questionDocs);
    const allGraded = essayIds.every(
      (questionId) => manualScores[questionId] !== undefined,
    );
    if (!allGraded || attempt.gradedAt !== undefined) return null;

    const now = Date.now();
    await ctx.db.patch("examAttempts", args.attemptId, {
      gradedAt: now,
      gradedBy: staff.id,
    });
    await logAudit(ctx, {
      actorType: "staff",
      actorId: staff.id,
      action: "exam.grade_essay_complete",
      targetType: "examAttempt",
      targetId: args.attemptId,
      meta: { examId: exam._id },
    });
    const total = round2(
      (attempt.autoScore ?? 0) + sumManualScores(manualScores),
    );
    await notifyStudents(ctx, [attempt.studentId], {
      type: "result",
      title: `ظهرت نتيجتك: ${exam.title}`,
      body: `${total}/${attempt.maxScore}`,
      refType: "exam",
      refId: exam._id,
    });
    // M6 award, deferred from submit for essay exams — combined total.
    // awardOnce dedupes on the attempt id, so only the first completion
    // (or an earlier essay-free submit path) ever awards.
    await awardForExam(ctx, {
      studentId: attempt.studentId,
      attemptId: args.attemptId,
      autoScore: total,
      maxScore: attempt.maxScore,
      day: new Date(now).toISOString().slice(0, 10),
    });
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
    const exam = await requireExamOwner(ctx, staff, attempt.examId);
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
    // M5: the student's effective score just changed — notify them.
    await notifyStudents(ctx, [attempt.studentId], {
      type: "result",
      title: `تحدّثت درجتك: ${exam.title}`,
      body: `${args.score}/${attempt.maxScore}`,
      refType: "exam",
      refId: attempt.examId,
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
