import { ConvexError, v } from "convex/values";
import {
  internalMutation,
  mutation,
  query,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireStudentAccount } from "./studentAuth";
import { loadQuestionDocs, loadSubjectBank, ruleMatches } from "./exams";
import { awardForExam } from "./gamification";
import { logAudit } from "./lib/audit";
import {
  effectiveScore,
  gradeAnswers,
  hasEssay,
  questionSetOf,
  type StoredAnswer,
} from "./lib/grading";
import { notifyStudents } from "./lib/notify";
import { djb2, seededShuffle } from "./lib/shuffle";
import { attemptStatus, questionType } from "./lib/validators";

/**
 * M4/M8 — exam attempts (student/parent portal). Every public function takes
 * the bearer `sessionToken` and resolves it via requireStudentAccount; an
 * attempt is only ever readable/writable by its own student. Answers are
 * merged server-side; grading is server-only.
 *
 * CRITICAL INVARIANTS:
 *   · nothing in this file may ever return `correctOptionId` / `correctBool`
 *     / `blanks.acceptedAnswers` — the exam window may still be open;
 *   · matching pair rights and ordering items are ALWAYS sent shuffled
 *     (their doc order IS the correct answer); question order and mcq
 *     options shuffle only when exam.shuffle !== false;
 *   · essay exams withhold every score until the teacher finishes grading
 *     (attempt.gradedAt) — until then gradingPending is true and
 *     autoScore/overrideScore/totalScore stay undefined;
 *   · M15: a version-ruled exam samples a per-student questionSet at start —
 *     EVERY question read below goes through questionSetOf(attempt, exam).
 *
 * Domain errors use `ConvexError` codes the RTL UI maps to Arabic messages:
 *   not_found · exam_not_open · not_enrolled · attempt_expired
 *   insufficient_bank
 */

/** Extra time after the deadline during which answer saves still land. */
const SAVE_GRACE_MS = 30_000;

/** Longest accepted essay answer (chars); fill-blank entries stay short. */
const MAX_ESSAY_ANSWER_LENGTH = 8000;
const MAX_BLANK_ANSWER_LENGTH = 500;
const MAX_OPTION_ID_LENGTH = 200;

// Per-type answer values (see schema examAttempts.answers).
const answersValidator = v.record(
  v.id("questions"),
  v.union(
    v.string(),
    v.boolean(),
    v.array(v.string()),
    v.record(v.string(), v.string()),
  ),
);

const examState = v.union(
  v.literal("upcoming"),
  v.literal("available"),
  v.literal("in_progress"),
  v.literal("submitted"),
  v.literal("pending_grading"),
  v.literal("missed"),
);

/**
 * Opaque per-attempt ids for matching RIGHT options and ordering items. The
 * REAL ids would leak the answer key even when shuffled: a matching right
 * option shares its pair's id (left id === correct right id), and authoring
 * tools mint sequential ids, so sorting them reconstructs doc order. The
 * token is the entry's index in the attempt's seeded shuffle — stable across
 * reloads, meaningless to the client, recomputable server-side to translate
 * both directions (getAttempt tokenizes, saveAnswers detokenizes).
 */
function tokenMaps(
  entries: ReadonlyArray<{ id: string }>,
  seed: number,
  salt: string,
  prefix: string,
): { toToken: Map<string, string>; toReal: Map<string, string> } {
  const shuffled = seededShuffle(entries, seed, salt);
  const toToken = new Map<string, string>();
  const toReal = new Map<string, string>();
  shuffled.forEach((entry, index) => {
    toToken.set(entry.id, `${prefix}${index}`);
    toReal.set(`${prefix}${index}`, entry.id);
  });
  return { toToken, toReal };
}

/**
 * Whether a question set references ≥1 essay question — early-exit probe,
 * bounded by the set's size. Used where the full doc map isn't needed;
 * callers pass questionSetOf(attempt, exam) so versioned attempts probe
 * their OWN sampled set.
 */
async function probeHasEssay(
  ctx: QueryCtx,
  questionSet: Array<{ questionId: Id<"questions"> }>,
): Promise<boolean> {
  for (const examQuestion of questionSet) {
    const question = await ctx.db.get("questions", examQuestion.questionId);
    if (question?.type === "essay") return true;
  }
  return false;
}

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
      state:
        | "upcoming"
        | "available"
        | "in_progress"
        | "submitted"
        | "pending_grading"
        | "missed";
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
          if (attempt.gradedAt !== undefined) {
            // Essay exam, fully graded → combined total (override wins).
            state = "submitted";
            score = effectiveScore(attempt);
          } else if (await probeHasEssay(ctx, questionSetOf(attempt, exam))) {
            // Essay attempt awaiting manual grading — no score yet.
            state = "pending_grading";
          } else {
            state = "submitted";
            score = attempt.overrideScore ?? attempt.autoScore;
          }
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
 * One attempt with its exam's questions for the taking/review screen,
 * sanitized per type — nothing here may leak a correct answer:
 *   mcq       → options { id, text } (shuffled when exam.shuffle !== false)
 *   truefalse → options []
 *   fillblank → text + blankCount ONLY (acceptedAnswers NEVER leave)
 *   matching  → pairsLeft { id, left } in doc order + rightOptions
 *               { id, text } ALWAYS shuffled (doc order = the solution) and
 *               carrying opaque per-attempt token ids (the real id is the
 *               pair id — it would name the matching left item)
 *   ordering  → orderItems { id, text } ALWAYS shuffled (doc order = the
 *               correct order), token ids (real ids sort into doc order)
 *   essay     → text only (the rubric is teacher-side)
 * imageUrl accompanies any type. Question ORDER shuffles (salt "questions")
 * when exam.shuffle !== false. All shuffles are seeded by the attempt, so
 * reloads are stable.
 *
 * Score gating (essay exams): while submitted-but-ungraded, gradingPending
 * is true and autoScore/overrideScore/totalScore are withheld; once graded
 * (or essay-free), totalScore = override ?? autoScore + Σ manualScores, and
 * per-essay feedback { text, audioUrl } is attached for the result view.
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
    totalScore: v.optional(v.number()), // combined, only once final
    gradingPending: v.boolean(),
    maxScore: v.number(),
    totalMarks: v.number(),
    noBacktrack: v.boolean(), // M15 — UI switches to one-question-at-a-time
    feedback: v.optional(
      v.record(
        v.id("questions"),
        v.object({
          text: v.optional(v.string()),
          audioUrl: v.optional(v.string()),
        }),
      ),
    ),
    questions: v.array(
      v.object({
        questionId: v.id("questions"),
        type: questionType,
        text: v.string(),
        options: v.array(v.object({ id: v.string(), text: v.string() })),
        marks: v.number(),
        imageUrl: v.optional(v.string()),
        blankCount: v.optional(v.number()),
        pairsLeft: v.optional(
          v.array(v.object({ id: v.string(), left: v.string() })),
        ),
        rightOptions: v.optional(
          v.array(v.object({ id: v.string(), text: v.string() })),
        ),
        orderItems: v.optional(
          v.array(v.object({ id: v.string(), text: v.string() })),
        ),
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

    // Pre-M8 attempts carry no stored seed; djb2 of the attempt id is
    // exactly what start would have stamped, so the fallback is identical.
    const seed = attempt.seed ?? djb2(attempt._id);
    const shuffleEnabled = exam.shuffle !== false;
    // M15: the attempt's OWN question set (versioned exams sample at start).
    const questionSet = questionSetOf(attempt, exam);
    const questionDocs = await loadQuestionDocs(ctx, questionSet);
    const orderedExamQuestions = shuffleEnabled
      ? seededShuffle(questionSet, seed, "questions")
      : questionSet;

    const questions = [];
    for (const examQuestion of orderedExamQuestions) {
      const question = questionDocs.get(examQuestion.questionId);
      if (!question) continue; // never hard-deleted; defensive
      const questionId = examQuestion.questionId;
      const row: {
        questionId: Id<"questions">;
        type: Doc<"questions">["type"];
        text: string;
        options: Array<{ id: string; text: string }>;
        marks: number;
        imageUrl?: string;
        blankCount?: number;
        pairsLeft?: Array<{ id: string; left: string }>;
        rightOptions?: Array<{ id: string; text: string }>;
        orderItems?: Array<{ id: string; text: string }>;
      } = {
        questionId,
        type: question.type,
        text: question.text,
        options: [],
        marks: examQuestion.marks,
        imageUrl:
          question.imageId !== undefined
            ? ((await ctx.storage.getUrl(question.imageId)) ?? undefined)
            : undefined,
      };
      switch (question.type) {
        case "mcq": {
          // Strip to id/text — never the correct answer.
          const options = question.options.map((option) => ({
            id: option.id,
            text: option.text,
          }));
          row.options = shuffleEnabled
            ? seededShuffle(options, seed, `options:${questionId}`)
            : options;
          break;
        }
        case "truefalse":
          break; // options stay []
        case "fillblank":
          // Text carries the ____ placeholders; acceptedAnswers NEVER leave.
          row.blankCount = question.blanks?.length ?? 0;
          break;
        case "matching": {
          const pairs = question.pairs ?? [];
          row.pairsLeft = pairs.map((pair) => ({
            id: pair.id,
            left: pair.left,
          }));
          // ALWAYS shuffled — unshuffled rights would BE the answer key —
          // and tokenized: a right option's REAL id is its pair id, which
          // would name the matching left item outright.
          row.rightOptions = seededShuffle(
            pairs,
            seed,
            `right:${questionId}`,
          ).map((pair, index) => ({ id: `r${index}`, text: pair.right }));
          break;
        }
        case "ordering":
          // ALWAYS shuffled — doc order is the correct order — and
          // tokenized: authoring mints sequential item ids, so the real
          // ids would sort back into doc order.
          row.orderItems = seededShuffle(
            question.items ?? [],
            seed,
            `items:${questionId}`,
          ).map((item, index) => ({ id: `i${index}`, text: item.text }));
          break;
        case "essay":
          break; // rubricText is teacher-side only
      }
      questions.push(row);
    }

    // Stored answers hold REAL ids (grading compares them against doc
    // order / pair ids) — re-tokenize matching/ordering values so the
    // payload never links a left id to its right id or exposes sortable
    // item ids. Unmappable entries (tampered saves) are dropped.
    const answers: Record<Id<"questions">, StoredAnswer> = {};
    for (const [key, value] of Object.entries(attempt.answers)) {
      const question = questionDocs.get(key);
      const answerQuestionId = key as Id<"questions">;
      if (
        question?.type === "matching" &&
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value)
      ) {
        const { toToken } = tokenMaps(
          question.pairs ?? [],
          seed,
          `right:${key}`,
          "r",
        );
        const mapped: Record<string, string> = {};
        for (const [leftId, rightId] of Object.entries(value)) {
          const token = toToken.get(rightId);
          if (token !== undefined) mapped[leftId] = token;
        }
        answers[answerQuestionId] = mapped;
      } else if (question?.type === "ordering" && Array.isArray(value)) {
        const { toToken } = tokenMaps(
          question.items ?? [],
          seed,
          `items:${key}`,
          "i",
        );
        answers[answerQuestionId] = value.flatMap((id) => {
          const token = toToken.get(id);
          return token !== undefined ? [token] : [];
        });
      } else {
        answers[answerQuestionId] = value;
      }
    }

    const pending =
      attempt.status === "submitted" &&
      attempt.gradedAt === undefined &&
      hasEssay(questionSet, questionDocs);
    const finalScoreKnown = attempt.status === "submitted" && !pending;

    let feedback:
      | Record<Id<"questions">, { text?: string; audioUrl?: string }>
      | undefined;
    if (finalScoreKnown && attempt.feedback !== undefined) {
      feedback = {};
      for (const [questionId, entry] of Object.entries(attempt.feedback)) {
        feedback[questionId as Id<"questions">] = {
          text: entry.text,
          audioUrl:
            entry.audioId !== undefined
              ? ((await ctx.storage.getUrl(entry.audioId)) ?? undefined)
              : undefined,
        };
      }
    }

    return {
      examTitle: exam.title,
      subjectName: subject?.name,
      status: attempt.status,
      startedAt: attempt.startedAt,
      deadlineAt: attempt.deadlineAt,
      submittedAt: attempt.submittedAt,
      answers,
      autoScore: pending ? undefined : attempt.autoScore,
      overrideScore: pending ? undefined : attempt.overrideScore,
      totalScore: finalScoreKnown ? effectiveScore(attempt) : undefined,
      gradingPending: pending,
      maxScore: attempt.maxScore,
      totalMarks: attempt.maxScore,
      noBacktrack: exam.noBacktrack === true,
      feedback,
      questions,
    };
  },
});

// ——— Mutations ———

/**
 * M15 — sample one attempt's question set from the subject bank. Rules run
 * in listed order; each draws `count` questions WITHOUT replacement — also
 * across rules, since answers are keyed by question id (a duplicate could
 * hold only one answer yet be graded twice) — from its matching non-archived
 * pool, sorted by _id for determinism and then seeded-shuffled (mulberry32
 * via seededShuffle, salt "rule:<index>"). Publish guaranteed sufficiency
 * over the non-archived bank; if it shrank since (post-publish archiving or
 * subject moves), archived matches are pulled back in — they still grade
 * fine, questions are never hard-deleted — before failing with
 * "insufficient_bank". Σ marks === exam.totalMarks by construction.
 */
function sampleQuestionSet(
  bank: Array<Doc<"questions">>,
  rules: NonNullable<Doc<"exams">["versionRules"]>,
  seed: number,
): Array<{ questionId: Id<"questions">; marks: number }> {
  const byId = (a: Doc<"questions">, b: Doc<"questions">): number =>
    a._id < b._id ? -1 : 1;
  const used = new Set<string>();
  const questionSet: Array<{ questionId: Id<"questions">; marks: number }> =
    [];
  for (const [index, rule] of rules.entries()) {
    const pool = bank
      .filter(
        (question) =>
          !question.archived &&
          ruleMatches(question, rule) &&
          !used.has(question._id),
      )
      .sort(byId);
    if (pool.length < rule.count) {
      pool.push(
        ...bank
          .filter(
            (question) =>
              question.archived &&
              ruleMatches(question, rule) &&
              !used.has(question._id),
          )
          .sort(byId),
      );
    }
    if (pool.length < rule.count) throw new ConvexError("insufficient_bank");
    const picked = seededShuffle(pool, seed, `rule:${index}`).slice(
      0,
      rule.count,
    );
    for (const question of picked) {
      used.add(question._id);
      questionSet.push({ questionId: question._id, marks: rule.marksEach });
    }
  }
  return questionSet;
}

/**
 * Start (or resume) the student's attempt on a published exam whose window
 * is open. At most one attempt per (exam, student) — an existing one is
 * returned as-is, never duplicated. The per-attempt deadline is
 * min(now + timeLimit, windowEnd) and an auto-submit is scheduled at it.
 * M15: version-ruled exams freeze the student's unique questionSet here.
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
    // M8 — shuffle seed: djb2 of the attempt id string. Deterministic (no
    // RNG state), unique per attempt, and computable post-insert in the
    // same patch that stores the expire handle.
    const seed = djb2(attemptId);
    // M15 — version-ruled exams sample this student's own question set now
    // (seeded by the attempt, so the whole mutation stays deterministic; a
    // sampling failure rolls the insert and the scheduled expire back).
    let questionSet:
      | Array<{ questionId: Id<"questions">; marks: number }>
      | undefined;
    if (exam.versionRules !== undefined && exam.versionRules.length > 0) {
      questionSet = sampleQuestionSet(
        await loadSubjectBank(ctx, exam.subjectId),
        exam.versionRules,
        seed,
      );
    }
    await ctx.db.patch("examAttempts", attemptId, {
      expireFnId,
      seed,
      questionSet,
    });
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
 * The per-type answer VALUE shape (invalid entries are dropped silently,
 * like unknown question keys — saves must never hard-fail mid-exam):
 *   mcq       → string (an option id)
 *   truefalse → boolean
 *   essay     → string, ≤8000 chars (the student's text)
 *   fillblank → string[] in blank order, ≤ blanks.length, entries ≤500
 *   ordering  → string[] of DISTINCT item ids (a subset, complete or not)
 *   matching  → record with keys ⊆ pair ids and values ⊆ pair ids
 * Runs AFTER detokenizeAnswer — ordering/matching values are real ids here.
 */
function isValidAnswerShape(
  question: Doc<"questions">,
  answer: StoredAnswer,
): boolean {
  switch (question.type) {
    case "mcq":
      return typeof answer === "string" && answer.length <= MAX_OPTION_ID_LENGTH;
    case "truefalse":
      return typeof answer === "boolean";
    case "essay":
      return (
        typeof answer === "string" && answer.length <= MAX_ESSAY_ANSWER_LENGTH
      );
    case "fillblank": {
      const blankCount = question.blanks?.length ?? 0;
      return (
        Array.isArray(answer) &&
        answer.length <= blankCount &&
        answer.every(
          (entry) =>
            typeof entry === "string" &&
            entry.length <= MAX_BLANK_ANSWER_LENGTH,
        )
      );
    }
    case "ordering": {
      if (!Array.isArray(answer)) return false;
      const itemIds = new Set((question.items ?? []).map((item) => item.id));
      if (answer.length > itemIds.size) return false;
      const seen = new Set<string>();
      for (const entry of answer) {
        if (typeof entry !== "string" || !itemIds.has(entry) || seen.has(entry)) {
          return false;
        }
        seen.add(entry);
      }
      return true;
    }
    case "matching": {
      if (
        typeof answer !== "object" ||
        answer === null ||
        Array.isArray(answer)
      ) {
        return false;
      }
      const pairIds = new Set((question.pairs ?? []).map((pair) => pair.id));
      return Object.entries(answer).every(
        ([leftId, rightId]) =>
          pairIds.has(leftId) &&
          typeof rightId === "string" &&
          pairIds.has(rightId),
      );
    }
  }
}

/**
 * Matching/ordering answers arrive in the WIRE shape of getAttempt — opaque
 * per-attempt tokens — and must be translated back to the real ids grading
 * compares against. Unknown tokens (tampering, or a stale pre-token client)
 * drop the entry (matching) or invalidate the value (ordering, where a hole
 * would corrupt the sequence). Other types pass through untouched.
 */
function detokenizeAnswer(
  question: Doc<"questions">,
  seed: number,
  answer: StoredAnswer,
): StoredAnswer | undefined {
  if (question.type === "matching") {
    if (
      typeof answer !== "object" ||
      answer === null ||
      Array.isArray(answer)
    ) {
      return undefined;
    }
    const { toReal } = tokenMaps(
      question.pairs ?? [],
      seed,
      `right:${question._id}`,
      "r",
    );
    const mapped: Record<string, string> = {};
    for (const [leftId, token] of Object.entries(answer)) {
      const real = typeof token === "string" ? toReal.get(token) : undefined;
      if (real !== undefined) mapped[leftId] = real;
    }
    return mapped;
  }
  if (question.type === "ordering") {
    if (!Array.isArray(answer)) return undefined;
    const { toReal } = tokenMaps(
      question.items ?? [],
      seed,
      `items:${question._id}`,
      "i",
    );
    const mapped: Array<string> = [];
    for (const token of answer) {
      const real = typeof token === "string" ? toReal.get(token) : undefined;
      if (real === undefined) return undefined;
      mapped.push(real);
    }
    return mapped;
  }
  return answer;
}

/**
 * Merge an answers batch into the student's own in-progress attempt.
 * Accepted until deadline + 30s grace (network slack); keys that are not
 * questions of this attempt — and values whose shape doesn't match the
 * question's type — are dropped silently.
 *
 * M15 no-backtrack: when exam.noBacktrack, a save may never touch a
 * question ordered BEFORE the furthest question that already has a stored
 * answer — the order being the same seeded shuffle getAttempt shows.
 * Violations drop silently like every other invalid entry (saves never
 * hard-fail mid-exam). Locking advances per SAVE-progression, not per
 * keystroke: the UI shows one question at a time and saves it before moving
 * forward, so re-saving the current furthest question stays allowed.
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

    // M15: validate against the attempt's OWN question set.
    const questionSet = questionSetOf(attempt, exam);
    const questionDocs = await loadQuestionDocs(ctx, questionSet);
    const seed = attempt.seed ?? djb2(attempt._id);

    // M15 no-backtrack: derive the attempt's question order (the exact
    // shuffle getAttempt serves) and the furthest already-answered index.
    const noBacktrack = exam.noBacktrack === true;
    const orderIndex = new Map<string, number>();
    let furthestAnswered = -1;
    if (noBacktrack) {
      const ordered =
        exam.shuffle !== false
          ? seededShuffle(questionSet, seed, "questions")
          : questionSet;
      ordered.forEach((examQuestion, index) => {
        orderIndex.set(examQuestion.questionId, index);
      });
      for (const key of Object.keys(attempt.answers)) {
        const index = orderIndex.get(key);
        if (index !== undefined && index > furthestAnswered) {
          furthestAnswered = index;
        }
      }
    }

    const cleaned: Record<Id<"questions">, StoredAnswer> = {};
    for (const [questionId, rawAnswer] of Object.entries(args.answers)) {
      const question = questionDocs.get(questionId);
      if (!question) continue; // drop unknown keys
      if (noBacktrack) {
        const index = orderIndex.get(questionId);
        if (index === undefined || index < furthestAnswered) continue; // locked
      }
      const answer = detokenizeAnswer(question, seed, rawAnswer);
      if (answer === undefined) continue; // drop untranslatable tokens
      if (!isValidAnswerShape(question, answer)) continue; // drop bad shapes
      cleaned[questionId as Id<"questions">] = answer;
    }
    await ctx.db.patch("examAttempts", args.attemptId, {
      answers: { ...attempt.answers, ...cleaned },
    });
    return null;
  },
});

/**
 * M15 — count one focus loss (tab blur / visibility change) on the
 * student's own in-progress attempt, capped at 999. High-frequency and
 * best-effort by design: no audit row, and an attempt that just got
 * submitted (race with expiry) is a silent no-op rather than an error.
 */
export const logFocusLoss = mutation({
  args: { sessionToken: v.string(), attemptId: v.id("examAttempts") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { studentId } = await requireStudentAccount(ctx, args.sessionToken);
    const attempt = await ctx.db.get("examAttempts", args.attemptId);
    if (!attempt || attempt.studentId !== studentId) {
      throw new ConvexError("not_found");
    }
    if (attempt.status !== "in_progress") return null;
    const next = Math.min((attempt.focusLossCount ?? 0) + 1, 999);
    if (next === attempt.focusLossCount) return null; // already at the cap
    await ctx.db.patch("examAttempts", args.attemptId, {
      focusLossCount: next,
    });
    return null;
  },
});

/**
 * Submit the student's own attempt: grade server-side, stamp submittedAt,
 * cancel the scheduled auto-submit. Idempotent — an already-submitted
 * attempt returns its stored scores unchanged.
 *
 * M8: when the exam has ≥1 essay the result is NOT final at submit — the
 * response withholds scores (gradingPending: true), the notification says
 * the answers were received, and the gamification award is deferred to
 * grading completion (exams.gradeEssay).
 */
export const submit = mutation({
  args: { sessionToken: v.string(), attemptId: v.id("examAttempts") },
  returns: v.object({
    autoScore: v.optional(v.number()), // withheld while gradingPending
    maxScore: v.number(),
    overrideScore: v.optional(v.number()),
    gradingPending: v.boolean(),
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
    const exam = await ctx.db.get("exams", attempt.examId);

    if (attempt.status === "submitted") {
      const pending =
        attempt.gradedAt === undefined &&
        exam !== null &&
        (await probeHasEssay(ctx, questionSetOf(attempt, exam)));
      return pending
        ? {
            autoScore: undefined,
            maxScore: attempt.maxScore,
            overrideScore: undefined,
            gradingPending: true,
          }
        : {
            autoScore: attempt.autoScore ?? 0,
            maxScore: attempt.maxScore,
            overrideScore: attempt.overrideScore,
            gradingPending: false,
          };
    }

    let autoScore = 0;
    let pendingGrading = false;
    if (exam) {
      // M15: grade the attempt's OWN question set (versioned exams).
      const questionSet = questionSetOf(attempt, exam);
      const questionDocs = await loadQuestionDocs(ctx, questionSet);
      autoScore = gradeAnswers(questionSet, questionDocs, attempt.answers);
      pendingGrading = hasEssay(questionSet, questionDocs);
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
    if (!pendingGrading) {
      // M6: exam points on the auto score at submit time. The day key is
      // UTC — acceptable drift around midnight (streaks don't read exam
      // days). Essay exams award later, on grading completion.
      await awardForExam(ctx, {
        studentId,
        attemptId: args.attemptId,
        autoScore,
        maxScore: attempt.maxScore,
        day: new Date().toISOString().slice(0, 10),
      });
    }
    // M5/M8: essay-free results are final at submit; essay exams only
    // acknowledge receipt (never the score).
    if (exam) {
      await notifyStudents(ctx, [studentId], {
        type: "result",
        title: pendingGrading
          ? `استلمنا إجاباتك: ${exam.title}`
          : `ظهرت نتيجتك: ${exam.title}`,
        body: pendingGrading
          ? "ستصلك النتيجة بعد اكتمال التصحيح"
          : `${autoScore}/${attempt.maxScore}`,
        refType: "exam",
        refId: attempt.examId,
      });
    }
    await logAudit(ctx, {
      actorType: "student",
      actorId: accessCodeId,
      action: "exam.attempt_submit",
      targetType: "examAttempt",
      targetId: args.attemptId,
      meta: { examId: attempt.examId, autoScore },
    });
    return pendingGrading
      ? {
          autoScore: undefined,
          maxScore: attempt.maxScore,
          overrideScore: undefined,
          gradingPending: true,
        }
      : {
          autoScore,
          maxScore: attempt.maxScore,
          overrideScore: attempt.overrideScore,
          gradingPending: false,
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
    let pendingGrading = false;
    if (exam) {
      // M15: grade the attempt's OWN question set (versioned exams).
      const questionSet = questionSetOf(attempt, exam);
      const questionDocs = await loadQuestionDocs(ctx, questionSet);
      autoScore = gradeAnswers(questionSet, questionDocs, attempt.answers);
      pendingGrading = hasEssay(questionSet, questionDocs);
    }
    await ctx.db.patch("examAttempts", args.attemptId, {
      status: "submitted",
      submittedAt: Date.now(),
      autoScore,
      expireFnId: undefined,
    });
    // M5/M8: expiry finalizes essay-free results (same notification as a
    // manual submit); essay exams only acknowledge receipt — the score and
    // the M6 award wait for grading completion (exams.gradeEssay).
    if (exam) {
      await notifyStudents(ctx, [attempt.studentId], {
        type: "result",
        title: pendingGrading
          ? `استلمنا إجاباتك: ${exam.title}`
          : `ظهرت نتيجتك: ${exam.title}`,
        body: pendingGrading
          ? "ستصلك النتيجة بعد اكتمال التصحيح"
          : `${autoScore}/${attempt.maxScore}`,
        refType: "exam",
        refId: attempt.examId,
      });
    }
    if (!pendingGrading) {
      // M6: expiry finalizes the score, so it awards exam points like submit.
      await awardForExam(ctx, {
        studentId: attempt.studentId,
        attemptId: args.attemptId,
        autoScore,
        maxScore: attempt.maxScore,
        day: new Date().toISOString().slice(0, 10),
      });
    }
    return null;
  },
});
