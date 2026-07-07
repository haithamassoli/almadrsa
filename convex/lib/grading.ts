import type { Doc } from "../_generated/dataModel";

/**
 * M4/M8 — pure auto-grading, shared verbatim by student submit, the deadline
 * expirer and the exam close sweep (kept ctx-free on purpose).
 *
 * Per type:
 *   mcq       → full marks iff answer === correctOptionId (string)
 *   truefalse → full marks iff answer === correctBool (boolean)
 *   fillblank → per-blank normalized compare against acceptedAnswers;
 *               marks · correct/total, rounded to 2dp
 *   matching  → marks · correctPairs/total, rounded to 2dp
 *   ordering  → all-or-nothing exact id sequence
 *   essay     → contributes 0 (graded manually via exams.gradeEssay)
 * Missing answers, missing question docs and shape mismatches score 0 for
 * that question.
 */

/** The widened per-question answer value (see schema `examAttempts.answers`). */
export type StoredAnswer =
  | string
  | boolean
  | Array<string>
  | Record<string, string>;

/** Round to 2 decimal places — keeps partial-credit contributions tidy. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Fill-blank comparison normalization: strip tatweel (U+0640) and Arabic
 * diacritics (harakat U+064B–U+065F + superscript alef U+0670), collapse
 * whitespace, trim — so «الفَجْر», «الفجر» and « الفجر » compare equal.
 * Deliberately does NOT fold hamza/teh-marbuta variants: teachers list
 * spelling variants in acceptedAnswers instead.
 */
export function normalizeArabic(s: string): string {
  return s
    .replace(/[\u0640\u064B-\u065F\u0670]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** One question's contribution to the auto score. */
function gradeOne(
  question: Doc<"questions">,
  marks: number,
  answer: StoredAnswer,
): number {
  switch (question.type) {
    case "mcq":
      return typeof answer === "string" &&
        question.correctOptionId !== undefined &&
        answer === question.correctOptionId
        ? marks
        : 0;
    case "truefalse":
      return typeof answer === "boolean" &&
        question.correctBool !== undefined &&
        answer === question.correctBool
        ? marks
        : 0;
    case "fillblank": {
      const blanks = question.blanks ?? [];
      if (!Array.isArray(answer) || blanks.length === 0) return 0;
      let correct = 0;
      for (let i = 0; i < blanks.length; i++) {
        const given = answer[i];
        if (typeof given !== "string") continue;
        const normalized = normalizeArabic(given);
        if (normalized.length === 0) continue;
        const accepted = blanks[i].acceptedAnswers.some(
          (candidate) => normalizeArabic(candidate) === normalized,
        );
        if (accepted) correct++;
      }
      return round2((marks * correct) / blanks.length);
    }
    case "matching": {
      const pairs = question.pairs ?? [];
      if (
        typeof answer !== "object" ||
        answer === null ||
        Array.isArray(answer) ||
        pairs.length === 0
      ) {
        return 0;
      }
      const chosen = answer as Record<string, string>;
      let correct = 0;
      // The record maps leftPairId → chosen rightPairId; a pair is correct
      // iff its left was matched to its own right (same pair id).
      for (const pair of pairs) {
        if (chosen[pair.id] === pair.id) correct++;
      }
      return round2((marks * correct) / pairs.length);
    }
    case "ordering": {
      const items = question.items ?? [];
      // ponytail: partial credit for orderings is contested — every scheme
      // (adjacent pairs, Kendall tau, longest common subsequence) over- or
      // under-rewards some permutations, so v2 pays full marks only for the
      // exact sequence. Doc order IS the correct order.
      if (!Array.isArray(answer) || items.length === 0) return 0;
      if (answer.length !== items.length) return 0;
      return items.every((item, i) => answer[i] === item.id) ? marks : 0;
    }
    case "essay":
      return 0; // manual grading only — never part of the auto score
  }
}

/**
 * M10 — binary correctness for topic analytics (weak-topic tallies). Routes
 * through the SAME gradeOne that gradeAnswers uses, so the per-type rules can
 * never drift between grading and analytics: grading a question at 1 mark
 * yields exactly 1 iff the answer is fully correct. fillblank/matching
 * therefore count as correct ONLY at full marks (every blank / every pair
 * right) — partial credit stays a grading concern; the topic tally is
 * deliberately binary for simplicity. Essays and missing answers are never
 * "correct" (callers exclude essays from tallies anyway).
 */
export function isAnswerCorrect(
  question: Doc<"questions">,
  answer: StoredAnswer | undefined,
): boolean {
  if (answer === undefined || question.type === "essay") return false;
  // correct/total === 1 exactly when everything matched, so no float fuzz.
  return gradeOne(question, 1, answer) === 1;
}

/** Sum of per-question contributions, rounded to 2dp (float drift). */
export function gradeAnswers(
  examQuestions: Array<{ questionId: string; marks: number }>,
  questionDocs: Map<string, Doc<"questions">>,
  answers: Record<string, StoredAnswer>,
): number {
  let score = 0;
  for (const examQuestion of examQuestions) {
    const question = questionDocs.get(examQuestion.questionId);
    if (!question) continue;
    const answer = answers[examQuestion.questionId];
    if (answer === undefined) continue;
    score += gradeOne(question, examQuestion.marks, answer);
  }
  return round2(score);
}

/**
 * Split an exam's frozen marks into the auto-gradable part and the essay
 * part. Missing question docs count as auto (defensive — they grade 0).
 */
export function splitScores(
  examQuestions: Array<{ questionId: string; marks: number }>,
  questionDocs: Map<string, Doc<"questions">>,
): { autoMarks: number; essayMarks: number } {
  let autoMarks = 0;
  let essayMarks = 0;
  for (const examQuestion of examQuestions) {
    if (questionDocs.get(examQuestion.questionId)?.type === "essay") {
      essayMarks += examQuestion.marks;
    } else {
      autoMarks += examQuestion.marks;
    }
  }
  return { autoMarks, essayMarks };
}

/** Whether the exam references ≥1 essay question (⇒ manual grading gate). */
export function hasEssay(
  examQuestions: Array<{ questionId: string }>,
  questionDocs: Map<string, Doc<"questions">>,
): boolean {
  return examQuestions.some(
    (examQuestion) =>
      questionDocs.get(examQuestion.questionId)?.type === "essay",
  );
}

/** Sum of the manual essay scores merged so far (undefined ⇒ 0). */
export function sumManualScores(
  manualScores: Record<string, number> | undefined,
): number {
  let sum = 0;
  if (manualScores) {
    for (const score of Object.values(manualScores)) sum += score;
  }
  return sum;
}
