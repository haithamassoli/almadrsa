import { ConvexError, v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireTeacher, type StaffUser } from "./auth";
import { logAudit } from "./lib/audit";
import {
  difficulty,
  questionType,
  type QuestionType,
} from "./lib/validators";

/**
 * M4/M8 — question bank (staff only). Questions belong to a subject and are
 * owned by their creator; admins may touch everything. Questions are never
 * hard-deleted (published exams reference them) — only archived, which hides
 * them from the bank and blocks NEW exams while old exams keep grading.
 * Domain errors use `ConvexError` codes the RTL UI maps to Arabic messages:
 *   not_found · not_assigned · not_owner · invalid_question
 *
 * NOTE: staff-gated reads DO include correctOptionId/correctBool/blanks/
 * pairs/items — teachers need them to display/edit. Student-facing reads
 * live in convex/attempts.ts and always strip/shuffle them.
 */

const MAX_TEXT_LENGTH = 2000;
const MAX_SIDE_LENGTH = 500; // pair left/right, ordering item text
const MAX_ACCEPTED_ANSWER_LENGTH = 200;
const MAX_BLANKS = 10;
const MAX_ACCEPTED_ANSWERS = 20;

/** fillblank placeholder: one run of ≥4 underscores per blank, in order. */
const BLANK_PLACEHOLDER = /_{4,}/g;

export const optionValidator = v.object({ id: v.string(), text: v.string() });
export const blankValidator = v.object({
  id: v.string(),
  acceptedAnswers: v.array(v.string()),
});
export const pairValidator = v.object({
  id: v.string(),
  left: v.string(),
  right: v.string(),
});
export const itemValidator = v.object({ id: v.string(), text: v.string() });

/** Shared arg fields of create/update (update adds `questionId`). */
const questionInputFields = {
  subjectId: v.id("subjects"),
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
  type: QuestionType;
  text: string;
  options: Array<{ id: string; text: string }>;
  correctOptionId?: string;
  correctBool?: boolean;
  blanks?: Array<{ id: string; acceptedAnswers: Array<string> }>;
  pairs?: Array<{ id: string; left: string; right: string }>;
  items?: Array<{ id: string; text: string }>;
  rubricText?: string;
  topic?: string;
};

type CleanedQuestion = {
  text: string;
  options: Array<{ id: string; text: string }>;
  correctOptionId: string | undefined;
  correctBool: boolean | undefined;
  blanks: Array<{ id: string; acceptedAnswers: Array<string> }> | undefined;
  pairs: Array<{ id: string; left: string; right: string }> | undefined;
  items: Array<{ id: string; text: string }> | undefined;
  rubricText: string | undefined;
  topic: string | undefined;
};

/** Any field carried by a type it does not belong to → "invalid_question". */
function forbidFields(...fields: Array<unknown>): void {
  for (const field of fields) {
    if (field !== undefined) throw new ConvexError("invalid_question");
  }
}

/** Nonempty unique machine ids (stored verbatim, like mcq option ids). */
function assertUniqueIds(ids: Array<string>): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (id.trim().length === 0 || seen.has(id)) {
      throw new ConvexError("invalid_question");
    }
    seen.add(id);
  }
}

/**
 * Matching pair ids additionally become KEYS of the student's answer record
 * (leftPairId → rightPairId), and Convex record keys must be nonempty ASCII
 * not starting with "$"/"_" — enforce that at authoring time.
 */
function isRecordKeySafe(id: string): boolean {
  return /^[!-~]+$/.test(id) && !id.startsWith("$") && !id.startsWith("_");
}

/**
 * Validate + normalize a question payload (shared by create/update). The
 * per-type matrix — any violation → "invalid_question":
 *   mcq       → 2–6 options (unique nonempty ids, nonempty texts),
 *               correctOptionId among them; nothing else
 *   truefalse → no options, a defined correctBool; nothing else
 *   fillblank → 1–10 blanks, each with 1–20 nonempty acceptedAnswers
 *               (≤200 chars); text carries exactly blanks.length "____"
 *               placeholders (runs of ≥4 underscores); nothing else
 *   matching  → 2–8 pairs (unique record-key-safe ids, nonempty left/right
 *               ≤500); nothing else
 *   ordering  → 2–8 items (unique nonempty ids, nonempty texts ≤500), DOC
 *               ORDER IS THE CORRECT ORDER; nothing else
 *   essay     → no options/correct answers/blanks/pairs/items; optional
 *               rubricText ≤2000 (teacher-side grading guide)
 * Empty arrays / blank strings count as absent, so UIs that always send
 * every field don't trip the matrix. `imageId` is allowed on ANY type and
 * handled by the callers.
 */
function cleanQuestionPayload(input: QuestionPayload): CleanedQuestion {
  const text = input.text.trim();
  if (text.length === 0 || text.length > MAX_TEXT_LENGTH) {
    throw new ConvexError("invalid_question");
  }
  const topicTrimmed = input.topic?.trim();
  const topic =
    topicTrimmed !== undefined && topicTrimmed.length > 0
      ? topicTrimmed
      : undefined;

  // Presence-normalize the per-type payloads: [] and "" mean "not provided".
  const blanks =
    input.blanks !== undefined && input.blanks.length > 0
      ? input.blanks
      : undefined;
  const pairs =
    input.pairs !== undefined && input.pairs.length > 0
      ? input.pairs
      : undefined;
  const items =
    input.items !== undefined && input.items.length > 0
      ? input.items
      : undefined;
  const rubricTrimmed = input.rubricText?.trim();
  const rubricText =
    rubricTrimmed !== undefined && rubricTrimmed.length > 0
      ? rubricTrimmed
      : undefined;

  const none: CleanedQuestion = {
    text,
    options: [],
    correctOptionId: undefined,
    correctBool: undefined,
    blanks: undefined,
    pairs: undefined,
    items: undefined,
    rubricText: undefined,
    topic,
  };

  switch (input.type) {
    case "mcq": {
      forbidFields(input.correctBool, blanks, pairs, items, rubricText);
      if (input.options.length < 2 || input.options.length > 6) {
        throw new ConvexError("invalid_question");
      }
      const options = input.options.map((option) => ({
        id: option.id, // machine identifier — stored verbatim
        text: option.text.trim(),
      }));
      assertUniqueIds(options.map((option) => option.id));
      for (const option of options) {
        if (option.text.length === 0) throw new ConvexError("invalid_question");
      }
      if (
        input.correctOptionId === undefined ||
        !options.some((option) => option.id === input.correctOptionId)
      ) {
        throw new ConvexError("invalid_question");
      }
      return { ...none, options, correctOptionId: input.correctOptionId };
    }

    case "truefalse": {
      forbidFields(input.correctOptionId, blanks, pairs, items, rubricText);
      if (input.options.length !== 0 || input.correctBool === undefined) {
        throw new ConvexError("invalid_question");
      }
      return { ...none, correctBool: input.correctBool };
    }

    case "fillblank": {
      forbidFields(
        input.correctOptionId,
        input.correctBool,
        pairs,
        items,
        rubricText,
      );
      if (input.options.length !== 0 || blanks === undefined) {
        throw new ConvexError("invalid_question");
      }
      if (blanks.length > MAX_BLANKS) throw new ConvexError("invalid_question");
      assertUniqueIds(blanks.map((blank) => blank.id));
      const cleanedBlanks = blanks.map((blank) => {
        // Trim answers, drop empties; ≥1 nonempty answer must remain.
        const acceptedAnswers = blank.acceptedAnswers
          .map((answer) => answer.trim())
          .filter((answer) => answer.length > 0);
        if (
          acceptedAnswers.length === 0 ||
          acceptedAnswers.length > MAX_ACCEPTED_ANSWERS ||
          acceptedAnswers.some(
            (answer) => answer.length > MAX_ACCEPTED_ANSWER_LENGTH,
          )
        ) {
          throw new ConvexError("invalid_question");
        }
        return { id: blank.id, acceptedAnswers };
      });
      // One "____" placeholder per blank, in blank order.
      const placeholders = text.match(BLANK_PLACEHOLDER)?.length ?? 0;
      if (placeholders !== cleanedBlanks.length) {
        throw new ConvexError("invalid_question");
      }
      return { ...none, blanks: cleanedBlanks };
    }

    case "matching": {
      forbidFields(
        input.correctOptionId,
        input.correctBool,
        blanks,
        items,
        rubricText,
      );
      if (
        input.options.length !== 0 ||
        pairs === undefined ||
        pairs.length < 2 ||
        pairs.length > 8
      ) {
        throw new ConvexError("invalid_question");
      }
      assertUniqueIds(pairs.map((pair) => pair.id));
      const cleanedPairs = pairs.map((pair) => {
        if (!isRecordKeySafe(pair.id)) throw new ConvexError("invalid_question");
        const left = pair.left.trim();
        const right = pair.right.trim();
        if (
          left.length === 0 ||
          right.length === 0 ||
          left.length > MAX_SIDE_LENGTH ||
          right.length > MAX_SIDE_LENGTH
        ) {
          throw new ConvexError("invalid_question");
        }
        return { id: pair.id, left, right };
      });
      return { ...none, pairs: cleanedPairs };
    }

    case "ordering": {
      forbidFields(
        input.correctOptionId,
        input.correctBool,
        blanks,
        pairs,
        rubricText,
      );
      if (
        input.options.length !== 0 ||
        items === undefined ||
        items.length < 2 ||
        items.length > 8
      ) {
        throw new ConvexError("invalid_question");
      }
      assertUniqueIds(items.map((item) => item.id));
      const cleanedItems = items.map((item) => {
        const itemText = item.text.trim();
        if (itemText.length === 0 || itemText.length > MAX_SIDE_LENGTH) {
          throw new ConvexError("invalid_question");
        }
        return { id: item.id, text: itemText };
      });
      return { ...none, items: cleanedItems };
    }

    case "essay": {
      forbidFields(input.correctOptionId, input.correctBool, blanks, pairs, items);
      if (input.options.length !== 0) throw new ConvexError("invalid_question");
      if (rubricText !== undefined && rubricText.length > MAX_TEXT_LENGTH) {
        throw new ConvexError("invalid_question");
      }
      return { ...none, rubricText };
    }
  }
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
      blanks: v.optional(v.array(blankValidator)),
      pairs: v.optional(v.array(pairValidator)),
      items: v.optional(v.array(itemValidator)),
      rubricText: v.optional(v.string()),
      imageId: v.optional(v.id("_storage")),
      imageUrl: v.optional(v.string()),
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
    const rows = [];
    for (const question of questions) {
      if (question.archived) continue;
      rows.push({
        _id: question._id,
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
        teacherId: question.teacherId,
      });
    }
    return rows;
  },
});

// ——— Mutations ———

/** An imageId (any type) must point at an actually-uploaded file. */
async function assertImageExists(
  ctx: QueryCtx,
  imageId: Id<"_storage"> | undefined,
): Promise<void> {
  if (imageId === undefined) return;
  const metadata = await ctx.db.system.get("_storage", imageId);
  if (metadata === null) throw new ConvexError("invalid_question");
}

/** Create a question in a subject the caller teaches (admin: any subject). */
export const create = mutation({
  args: questionInputFields,
  returns: v.id("questions"),
  handler: async (ctx, args) => {
    const staff = await requireTeacher(ctx);
    await assertStaffCanAccessSubject(ctx, staff, args.subjectId);
    const cleaned = cleanQuestionPayload(args);
    await assertImageExists(ctx, args.imageId);
    return await ctx.db.insert("questions", {
      teacherId: staff.id,
      subjectId: args.subjectId,
      type: args.type,
      text: cleaned.text,
      options: cleaned.options,
      correctOptionId: cleaned.correctOptionId,
      correctBool: cleaned.correctBool,
      blanks: cleaned.blanks,
      pairs: cleaned.pairs,
      items: cleaned.items,
      rubricText: cleaned.rubricText,
      imageId: args.imageId,
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
    await assertImageExists(ctx, args.imageId);
    // Type-foreign fields come back undefined from the cleaner, so a type
    // change clears the previous type's payload.
    await ctx.db.patch("questions", args.questionId, {
      subjectId: args.subjectId,
      type: args.type,
      text: cleaned.text,
      options: cleaned.options,
      correctOptionId: cleaned.correctOptionId, // undefined clears
      correctBool: cleaned.correctBool, // undefined clears
      blanks: cleaned.blanks, // undefined clears
      pairs: cleaned.pairs, // undefined clears
      items: cleaned.items, // undefined clears
      rubricText: cleaned.rubricText, // undefined clears
      imageId: args.imageId, // undefined clears (image removed)
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
