import type { Doc } from "../_generated/dataModel";

/**
 * M4 — pure auto-grading. No partial credit: a question is worth its full
 * `marks` iff the stored answer strictly equals the correct one.
 *   mcq       → answers[questionId] === correctOptionId (string)
 *   truefalse → answers[questionId] === correctBool (boolean)
 * Missing answers, missing question docs and type mismatches score 0 for
 * that question. Kept pure (no ctx) so it is shared verbatim by student
 * submit, the deadline expirer and the exam close sweep.
 */
export function gradeAnswers(
  examQuestions: Array<{ questionId: string; marks: number }>,
  questionDocs: Map<string, Doc<"questions">>,
  answers: Record<string, string | boolean>,
): number {
  let score = 0;
  for (const examQuestion of examQuestions) {
    const question = questionDocs.get(examQuestion.questionId);
    if (!question) continue;
    const answer = answers[examQuestion.questionId];
    if (answer === undefined) continue;
    const correct =
      question.type === "mcq"
        ? question.correctOptionId !== undefined &&
          answer === question.correctOptionId
        : question.correctBool !== undefined &&
          answer === question.correctBool;
    if (correct) score += examQuestion.marks;
  }
  return score;
}
