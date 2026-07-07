import { ConvexError, v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireTeacher, type StaffUser } from "./auth";
import { logAudit } from "./lib/audit";
import { difficulty, questionType } from "./lib/validators";

/**
 * M4 — question bank (staff only). Questions belong to a subject and are
 * owned by their creator; admins may touch everything. Questions are never
 * hard-deleted (published exams reference them) — only archived, which hides
 * them from the bank and blocks NEW exams while old exams keep grading.
 * Domain errors use `ConvexError` codes the RTL UI maps to Arabic messages:
 *   not_found · not_assigned · not_owner · invalid_question
 *
 * NOTE: staff-gated reads DO include correctOptionId/correctBool — teachers
 * need them to display/edit. Student-facing reads live in convex/attempts.ts
 * and always strip them.
 */

const MAX_TEXT_LENGTH = 2000;

const optionValidator = v.object({ id: v.string(), text: v.string() });

/** Shared arg fields of create/update (update adds `questionId`). */
const questionInputFields = {
  subjectId: v.id("subjects"),
  type: questionType,
  text: v.string(),
  options: v.array(optionValidator),
  correctOptionId: v.optional(v.string()),
  correctBool: v.optional(v.boolean()),
  topic: v.optional(v.string()),
  difficulty: difficulty,
};

// ——— Shared helpers ———

/**
 * Admin passes. Teacher must hold a teacherAssignments row for the subject
 * in SOME class. Shared by list (read scope) and create (write scope).
 */
async function assertStaffCanAccessSubject(
  ctx: QueryCtx,
  staff: StaffUser,
  subjectId: Id<"subjects">,
): Promise<void> {
  if (staff.role === "admin") return;
  const assignments = await ctx.db
    .query("teacherAssignments")
    .withIndex("by_teacherId", (q) => q.eq("teacherId", staff.id))
    .take(200);
  if (!assignments.some((a) => a.subjectId === subjectId)) {
    throw new ConvexError("not_assigned");
  }
}

/** Load a question the caller may edit: its creator, or any admin. */
async function getOwnedQuestion(
  ctx: QueryCtx,
  staff: StaffUser,
  questionId: Id<"questions">,
): Promise<Doc<"questions">> {
  const question = await ctx.db.get("questions", questionId);
  if (!question) throw new ConvexError("not_found");
  if (staff.role !== "admin" && question.teacherId !== staff.id) {
    throw new ConvexError("not_owner");
  }
  return question;
}

type QuestionPayload = {
  type: "mcq" | "truefalse";
  text: string;
  options: Array<{ id: string; text: string }>;
  correctOptionId?: string;
  correctBool?: boolean;
  topic?: string;
};

/**
 * Validate + normalize a question payload (shared by create/update).
 * mcq: 2–6 options with nonempty unique ids and nonempty texts,
 * correctOptionId among them, no correctBool. truefalse: no options, a
 * defined correctBool, no correctOptionId. Any violation → "invalid_question".
 */
function cleanQuestionPayload(input: QuestionPayload): {
  text: string;
  options: Array<{ id: string; text: string }>;
  correctOptionId: string | undefined;
  correctBool: boolean | undefined;
  topic: string | undefined;
} {
  const text = input.text.trim();
  if (text.length === 0 || text.length > MAX_TEXT_LENGTH) {
    throw new ConvexError("invalid_question");
  }
  const topicTrimmed = input.topic?.trim();
  const topic =
    topicTrimmed !== undefined && topicTrimmed.length > 0
      ? topicTrimmed
      : undefined;

  if (input.type === "mcq") {
    if (input.options.length < 2 || input.options.length > 6) {
      throw new ConvexError("invalid_question");
    }
    const ids = new Set<string>();
    const options = input.options.map((option) => ({
      id: option.id, // machine identifier — stored verbatim
      text: option.text.trim(),
    }));
    for (const option of options) {
      if (option.id.trim().length === 0 || option.text.length === 0) {
        throw new ConvexError("invalid_question");
      }
      if (ids.has(option.id)) throw new ConvexError("invalid_question");
      ids.add(option.id);
    }
    if (
      input.correctOptionId === undefined ||
      !ids.has(input.correctOptionId) ||
      input.correctBool !== undefined
    ) {
      throw new ConvexError("invalid_question");
    }
    return {
      text,
      options,
      correctOptionId: input.correctOptionId,
      correctBool: undefined,
      topic,
    };
  }

  // truefalse
  if (
    input.options.length !== 0 ||
    input.correctBool === undefined ||
    input.correctOptionId !== undefined
  ) {
    throw new ConvexError("invalid_question");
  }
  return {
    text,
    options: [],
    correctOptionId: undefined,
    correctBool: input.correctBool,
    topic,
  };
}

// ——— Queries ———

/**
 * The subject's question bank (archived rows hidden). Teachers must be
 * assigned to the subject in some class; admins see everything.
 */
export const list = query({
  args: { subjectId: v.id("subjects") },
  returns: v.array(
    v.object({
      _id: v.id("questions"),
      type: questionType,
      text: v.string(),
      options: v.array(optionValidator),
      correctOptionId: v.optional(v.string()),
      correctBool: v.optional(v.boolean()),
      topic: v.optional(v.string()),
      difficulty: difficulty,
      teacherId: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const staff = await requireTeacher(ctx);
    await assertStaffCanAccessSubject(ctx, staff, args.subjectId);
    const questions = await ctx.db
      .query("questions")
      .withIndex("by_subjectId", (q) => q.eq("subjectId", args.subjectId))
      .take(500);
    return questions
      .filter((question) => !question.archived)
      .map((question) => ({
        _id: question._id,
        type: question.type,
        text: question.text,
        options: question.options,
        correctOptionId: question.correctOptionId,
        correctBool: question.correctBool,
        topic: question.topic,
        difficulty: question.difficulty,
        teacherId: question.teacherId,
      }));
  },
});

// ——— Mutations ———

/** Create a question in a subject the caller teaches (admin: any subject). */
export const create = mutation({
  args: questionInputFields,
  returns: v.id("questions"),
  handler: async (ctx, args) => {
    const staff = await requireTeacher(ctx);
    await assertStaffCanAccessSubject(ctx, staff, args.subjectId);
    const cleaned = cleanQuestionPayload(args);
    return await ctx.db.insert("questions", {
      teacherId: staff.id,
      subjectId: args.subjectId,
      type: args.type,
      text: cleaned.text,
      options: cleaned.options,
      correctOptionId: cleaned.correctOptionId,
      correctBool: cleaned.correctBool,
      topic: cleaned.topic,
      difficulty: args.difficulty,
      archived: false,
    });
  },
});

/**
 * Full edit of a question (creator or admin). Published exams keep grading
 * against the LIVE question doc, so edits after publish do change grading —
 * the UI warns; marks per exam stay frozen on the exam row.
 */
export const update = mutation({
  args: { questionId: v.id("questions"), ...questionInputFields },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await requireTeacher(ctx);
    await getOwnedQuestion(ctx, staff, args.questionId);
    const cleaned = cleanQuestionPayload(args);
    await ctx.db.patch("questions", args.questionId, {
      subjectId: args.subjectId,
      type: args.type,
      text: cleaned.text,
      options: cleaned.options,
      correctOptionId: cleaned.correctOptionId, // undefined clears
      correctBool: cleaned.correctBool, // undefined clears
      topic: cleaned.topic, // undefined clears
      difficulty: args.difficulty,
    });
    return null;
  },
});

/**
 * Archive a question (creator or admin): hidden from the bank, blocked in
 * new exams, still graded in exams that already reference it.
 */
export const archive = mutation({
  args: { questionId: v.id("questions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await requireTeacher(ctx);
    const question = await getOwnedQuestion(ctx, staff, args.questionId);
    await ctx.db.patch("questions", args.questionId, { archived: true });
    await logAudit(ctx, {
      actorType: "staff",
      actorId: staff.id,
      action: "question.archive",
      targetType: "question",
      targetId: args.questionId,
      meta: { subjectId: question.subjectId, type: question.type },
    });
    return null;
  },
});
