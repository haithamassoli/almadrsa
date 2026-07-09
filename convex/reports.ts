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
import { requireAdmin, requireTeacher } from "./auth";
import { requireStudentAccount } from "./studentAuth";
import { assertStaffCanAccessStudent } from "./students";
import { logAudit } from "./lib/audit";
import { effectiveScore } from "./lib/grading";
import { notifyStudents } from "./lib/notify";
import { reportStatus } from "./lib/validators";

/**
 * M11 — term report cards. A card is a per-(student, term) SNAPSHOT of the
 * three grade components per subject (exams / homework / participation),
 * weighted by the subject's gradeWeights row (60/20/20 default), plus a
 * whole-class attendance summary. Cards are computed per student in small
 * scheduled transactions (generateForClass fans out), stay recomputable
 * while draft, and freeze forever on publish. Publish flow is admin-only
 * this milestone (teachers may only edit remarks on drafts); students read
 * their OWN published cards through the portal.
 *
 * Domain errors use `ConvexError` codes the RTL UI maps to Arabic messages:
 *   not_found · class_not_found · term_not_found · report_published
 *   invalid_input
 */

const MAX_REMARKS_LENGTH = 2000;

// Convention: a subject with no gradeWeights row grades 60/20/20 (the
// weights admin page shows such subjects as "unset"; this is the effective
// fallback the report applies — mirrored in the card so it's auditable).
const DEFAULT_WEIGHTS = { exams: 60, homework: 20, participation: 20 };

// ——— Shared validators ———

const cardSubjectValidator = v.object({
  subjectId: v.id("subjects"),
  subjectName: v.string(),
  examsPct: v.optional(v.number()),
  homeworkPct: v.optional(v.number()),
  participationPct: v.optional(v.number()),
  weights: v.object({
    exams: v.number(),
    homework: v.number(),
    participation: v.number(),
  }),
  finalPct: v.number(),
});

const cardAttendanceValidator = v.object({
  present: v.number(),
  late: v.number(),
  absent: v.number(),
  rate: v.number(),
});

const cardDetailValidator = v.object({
  cardId: v.id("reportCards"),
  studentId: v.id("students"),
  classId: v.id("classes"),
  termId: v.id("terms"),
  status: reportStatus,
  remarks: v.optional(v.string()),
  subjects: v.array(cardSubjectValidator),
  attendance: cardAttendanceValidator,
  computedAt: v.number(),
  publishedAt: v.optional(v.number()),
  studentName: v.string(),
  termName: v.string(),
  className: v.string(),
});

// ——— Shared helpers ———

/** Round to 1 decimal place — the precision every card percentage uses. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** "YYYY-MM-DD" (UTC) of a ms timestamp — the lesson/attendance key space. */
function toDateKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Mean of the card's subject finalPct values (1dp); undefined when empty. */
function finalAvgOf(card: Doc<"reportCards">): number | undefined {
  if (card.subjects.length === 0) return undefined;
  const sum = card.subjects.reduce((total, s) => total + s.finalPct, 0);
  return round1(sum / card.subjects.length);
}

/**
 * Weighted final over the AVAILABLE components only, weights renormalized to
 * the available set (no homework in the term ⇒ exams + participation weights
 * rescale to sum 1). No component ⇒ 0. All-zero weights over the available
 * set (admin put the full 100 on a component with no data) fall back to a
 * plain mean — better than a punitive 0 for a structure-config artifact.
 */
function computeFinalPct(
  components: Array<{ pct: number | undefined; weight: number }>,
): number {
  const available = components.filter(
    (c): c is { pct: number; weight: number } => c.pct !== undefined,
  );
  if (available.length === 0) return 0;
  const weightSum = available.reduce((sum, c) => sum + c.weight, 0);
  if (weightSum <= 0) {
    return round1(
      available.reduce((sum, c) => sum + c.pct, 0) / available.length,
    );
  }
  return round1(
    available.reduce((sum, c) => sum + c.pct * c.weight, 0) / weightSum,
  );
}

/**
 * Whether a question set references ≥1 essay question — early-exit probe
 * (same as attempts.ts). Only consulted for submitted-but-unstamped
 * attempts, where "essay pending grading" must exclude the score as
 * non-final. M15: callers pass attempt.questionSet ?? exam.questions so
 * versioned attempts probe their OWN sampled set.
 */
async function examHasEssayProbe(
  ctx: QueryCtx,
  questionSet: Array<{ questionId: Id<"questions"> }>,
): Promise<boolean> {
  for (const examQuestion of questionSet) {
    const question = await ctx.db.get("questions", examQuestion.questionId);
    if (question?.type === "essay") return true;
  }
  return false;
}

/** Full card + joined names, shared by getCard and getForStudent. */
async function buildCardDetail(
  ctx: QueryCtx,
  card: Doc<"reportCards">,
): Promise<{
  cardId: Id<"reportCards">;
  studentId: Id<"students">;
  classId: Id<"classes">;
  termId: Id<"terms">;
  status: Doc<"reportCards">["status"];
  remarks?: string;
  subjects: Doc<"reportCards">["subjects"];
  attendance: Doc<"reportCards">["attendance"];
  computedAt: number;
  publishedAt?: number;
  studentName: string;
  termName: string;
  className: string;
}> {
  const student = await ctx.db.get("students", card.studentId);
  const term = await ctx.db.get("terms", card.termId);
  const cls = await ctx.db.get("classes", card.classId);
  return {
    cardId: card._id,
    studentId: card.studentId,
    classId: card.classId,
    termId: card.termId,
    status: card.status,
    remarks: card.remarks,
    subjects: card.subjects,
    attendance: card.attendance,
    computedAt: card.computedAt,
    publishedAt: card.publishedAt,
    studentName: student ? `${student.firstName} ${student.lastName}` : "",
    termName: term?.name ?? "",
    className: cls?.name ?? "",
  };
}

// ——— Computation (scheduled per student by generateForClass) ———

/**
 * Compute (or recompute) ONE student's card for a term — upserted on
 * (student, term); a PUBLISHED card is a frozen snapshot and is never
 * recomputed. Per subject of the class's grade, over the term window
 * [term.startDate, term.endDate]:
 *   examsPct         avg pct over the student's FINAL submitted attempts on
 *                    exams of (class, subject) whose windowStart lies in the
 *                    term — essay-aware: effective = override ??
 *                    round2(auto + Σ manual), and an essay attempt still
 *                    awaiting grading is excluded; undefined when none.
 *   homeworkPct      avg grade/marks pct over GRADED submissions on homework
 *                    of (class, subject) with a deadline in the term;
 *                    undefined when none.
 *   participationPct term attendance rate (present+late)/marked over this
 *                    class+subject's lessons. ponytail: participation is
 *                    proxied by attendance until a dedicated participation
 *                    entry exists — rename-in-place then.
 *   finalPct         weighted over available components (computeFinalPct).
 * Plus the whole-class attendance summary (all subjects of this class).
 * Draft remarks survive a recompute.
 */
export const computeForStudent = internalMutation({
  args: {
    studentId: v.id("students"),
    termId: v.id("terms"),
    classId: v.id("classes"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("reportCards")
      .withIndex("by_studentId_and_termId", (q) =>
        q.eq("studentId", args.studentId).eq("termId", args.termId),
      )
      .first();
    if (existing?.status === "published") return null; // frozen — skip

    const term = await ctx.db.get("terms", args.termId);
    const cls = await ctx.db.get("classes", args.classId);
    if (!term || !cls) return null; // scheduled run raced a delete — drop

    const subjects = await ctx.db
      .query("subjects")
      .withIndex("by_gradeId", (q) => q.eq("gradeId", cls.gradeId))
      .take(100);

    // ——— Exams of the class whose window STARTS inside the term (draft
    // exams have no attempts; newest first so a >200 backlog sheds the
    // oldest — likely prior-term — rows). ———
    const examsBySubject = new Map<Id<"subjects">, Array<Doc<"exams">>>();
    for (const status of ["published", "closed"] as const) {
      const rows = await ctx.db
        .query("exams")
        .withIndex("by_classId_and_status", (q) =>
          q.eq("classId", args.classId).eq("status", status),
        )
        .order("desc")
        .take(200);
      for (const exam of rows) {
        if (
          exam.windowStart < term.startDate ||
          exam.windowStart > term.endDate
        ) {
          continue;
        }
        const bucket = examsBySubject.get(exam.subjectId);
        if (bucket) bucket.push(exam);
        else examsBySubject.set(exam.subjectId, [exam]);
      }
    }

    // ——— Homework of the class with a deadline inside the term. ———
    const homeworkBySubject = new Map<Id<"subjects">, Array<Doc<"homework">>>();
    const homeworkRows = await ctx.db
      .query("homework")
      .withIndex("by_classId", (q) => q.eq("classId", args.classId))
      .order("desc")
      .take(200);
    for (const homework of homeworkRows) {
      if (homework.deadline < term.startDate || homework.deadline > term.endDate) {
        continue;
      }
      const bucket = homeworkBySubject.get(homework.subjectId);
      if (bucket) bucket.push(homework);
      else homeworkBySubject.set(homework.subjectId, [homework]);
    }

    // ——— Term attendance: one indexed range read, tallied whole-class and
    // per subject (a full term is ≈65 school days × ≤8 periods, so 800
    // comfortably covers it). Rows of OTHER classes (mid-term moves) are
    // excluded — this card reports on args.classId. ———
    const attendanceRows = await ctx.db
      .query("attendance")
      .withIndex("by_studentId_and_date", (q) =>
        q
          .eq("studentId", args.studentId)
          .gte("date", toDateKey(term.startDate))
          .lte("date", toDateKey(term.endDate)),
      )
      .take(800);
    const totals = { present: 0, late: 0, absent: 0 };
    const attendanceBySubject = new Map<
      Id<"subjects">,
      { attended: number; marked: number }
    >();
    for (const row of attendanceRows) {
      if (row.classId !== args.classId) continue;
      totals[row.status]++;
      // Lessons with attendance are undeletable; skip defensively if an old
      // row ever dangles (it still counts in the whole-class totals).
      const lesson = await ctx.db.get("lessons", row.lessonId);
      if (!lesson) continue;
      let tally = attendanceBySubject.get(lesson.subjectId);
      if (!tally) {
        tally = { attended: 0, marked: 0 };
        attendanceBySubject.set(lesson.subjectId, tally);
      }
      tally.marked++;
      if (row.status === "present" || row.status === "late") tally.attended++;
    }
    const marked = totals.present + totals.late + totals.absent;
    const attendance = {
      ...totals,
      rate:
        marked > 0
          ? round1(((totals.present + totals.late) / marked) * 100)
          : 0,
    };

    // ——— Per-subject component averages + weighted final. ———
    const subjectRows: Doc<"reportCards">["subjects"] = [];
    for (const subject of subjects) {
      const examPcts: Array<number> = [];
      for (const exam of examsBySubject.get(subject._id) ?? []) {
        const attempt = await ctx.db
          .query("examAttempts")
          .withIndex("by_examId_and_studentId", (q) =>
            q.eq("examId", exam._id).eq("studentId", args.studentId),
          )
          .unique();
        if (
          !attempt ||
          attempt.status !== "submitted" ||
          attempt.maxScore <= 0
        ) {
          continue;
        }
        // Essay attempts: the score is only final once grading is stamped.
        // M15: the attempt's own question set decides (versioned exams).
        if (
          attempt.gradedAt === undefined &&
          (await examHasEssayProbe(ctx, attempt.questionSet ?? exam.questions))
        ) {
          continue;
        }
        const effective = effectiveScore(attempt);
        examPcts.push((effective / attempt.maxScore) * 100);
      }
      const examsPct =
        examPcts.length > 0
          ? round1(examPcts.reduce((s, p) => s + p, 0) / examPcts.length)
          : undefined;

      const homeworkPcts: Array<number> = [];
      for (const homework of homeworkBySubject.get(subject._id) ?? []) {
        const submission = await ctx.db
          .query("homeworkSubmissions")
          .withIndex("by_homeworkId_and_studentId", (q) =>
            q.eq("homeworkId", homework._id).eq("studentId", args.studentId),
          )
          .unique();
        if (submission?.grade === undefined) continue; // ungraded/missing
        homeworkPcts.push((submission.grade / homework.marks) * 100);
      }
      const homeworkPct =
        homeworkPcts.length > 0
          ? round1(
              homeworkPcts.reduce((s, p) => s + p, 0) / homeworkPcts.length,
            )
          : undefined;

      const tally = attendanceBySubject.get(subject._id);
      const participationPct =
        tally !== undefined && tally.marked > 0
          ? round1((tally.attended / tally.marked) * 100)
          : undefined;

      const weightsRow = await ctx.db
        .query("gradeWeights")
        .withIndex("by_subjectId", (q) => q.eq("subjectId", subject._id))
        .first();
      const weights = weightsRow
        ? {
            exams: weightsRow.examsPct,
            homework: weightsRow.homeworkPct,
            participation: weightsRow.participationPct,
          }
        : { ...DEFAULT_WEIGHTS };

      subjectRows.push({
        subjectId: subject._id,
        subjectName: subject.name,
        examsPct,
        homeworkPct,
        participationPct,
        weights,
        finalPct: computeFinalPct([
          { pct: examsPct, weight: weights.exams },
          { pct: homeworkPct, weight: weights.homework },
          { pct: participationPct, weight: weights.participation },
        ]),
      });
    }

    const now = Date.now();
    if (existing) {
      // Draft recompute: refresh the snapshot, keep remarks and status.
      await ctx.db.patch("reportCards", existing._id, {
        classId: args.classId,
        subjects: subjectRows,
        attendance,
        computedAt: now,
      });
    } else {
      await ctx.db.insert("reportCards", {
        studentId: args.studentId,
        termId: args.termId,
        classId: args.classId,
        status: "draft",
        subjects: subjectRows,
        attendance,
        computedAt: now,
      });
    }
    return null;
  },
});

// ——— Staff (admin publish flow) ———

/**
 * Fan out one scheduled compute per actively enrolled student, staggered
 * 100ms apart — each card is its own small transaction, so a whole-class
 * generate never approaches the read limits. Published cards are skipped
 * inside computeForStudent. Returns how many computes were scheduled.
 */
export const generateForClass = mutation({
  args: { classId: v.id("classes"), termId: v.id("terms") },
  returns: v.number(),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const cls = await ctx.db.get("classes", args.classId);
    if (!cls) throw new ConvexError("class_not_found");
    const term = await ctx.db.get("terms", args.termId);
    if (!term) throw new ConvexError("term_not_found");

    const enrollments = await ctx.db
      .query("enrollments")
      .withIndex("by_classId_and_active", (q) =>
        q.eq("classId", args.classId).eq("active", true),
      )
      .take(200);
    for (let i = 0; i < enrollments.length; i++) {
      await ctx.scheduler.runAfter(
        i * 100,
        internal.reports.computeForStudent,
        {
          studentId: enrollments[i].studentId,
          termId: args.termId,
          classId: args.classId,
        },
      );
    }
    await logAudit(ctx, {
      actorType: "staff",
      actorId: admin.id,
      action: "report.generate",
      targetType: "class",
      targetId: args.classId,
      meta: { termId: args.termId, count: enrollments.length },
    });
    return enrollments.length;
  },
});

/**
 * The class roster LEFT JOINed with its cards for a term — the publish
 * screen's table. Admin-only this milestone (the publish flow is admin's;
 * teachers get read views on their own pages later).
 */
export const listForClass = query({
  args: { classId: v.id("classes"), termId: v.id("terms") },
  returns: v.array(
    v.object({
      studentId: v.id("students"),
      studentName: v.string(),
      cardId: v.optional(v.id("reportCards")),
      status: v.optional(reportStatus),
      finalAvg: v.optional(v.number()), // mean of subject finalPct, 1dp
      computedAt: v.optional(v.number()),
      publishedAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const cards = await ctx.db
      .query("reportCards")
      .withIndex("by_classId_and_termId", (q) =>
        q.eq("classId", args.classId).eq("termId", args.termId),
      )
      .take(300);
    const cardByStudent = new Map<Id<"students">, Doc<"reportCards">>();
    for (const card of cards) cardByStudent.set(card.studentId, card);

    const enrollments = await ctx.db
      .query("enrollments")
      .withIndex("by_classId_and_active", (q) =>
        q.eq("classId", args.classId).eq("active", true),
      )
      .take(200);
    const rows = [];
    for (const enrollment of enrollments) {
      const student = await ctx.db.get("students", enrollment.studentId);
      if (!student) continue;
      const card = cardByStudent.get(enrollment.studentId);
      rows.push({
        studentId: student._id,
        studentName: `${student.firstName} ${student.lastName}`,
        cardId: card?._id,
        status: card?.status,
        finalAvg: card ? finalAvgOf(card) : undefined,
        computedAt: card?.computedAt,
        publishedAt: card?.publishedAt,
      });
    }
    rows.sort((a, b) =>
      a.studentName < b.studentName ? -1 : a.studentName > b.studentName ? 1 : 0,
    );
    return rows;
  },
});

/** One full card with joined names (admin-only staff view). */
export const getCard = query({
  args: { cardId: v.id("reportCards") },
  returns: cardDetailValidator,
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const card = await ctx.db.get("reportCards", args.cardId);
    if (!card) throw new ConvexError("not_found");
    return await buildCardDetail(ctx, card);
  },
});

/**
 * Teacher remarks on a DRAFT card (published ⇒ "report_published"). Teachers
 * need scope over the student (assignment to one of their active classes);
 * admins pass. ≤2000 chars; whitespace-only clears.
 */
export const updateRemarks = mutation({
  args: { cardId: v.id("reportCards"), remarks: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await requireTeacher(ctx);
    const card = await ctx.db.get("reportCards", args.cardId);
    if (!card) throw new ConvexError("not_found");
    await assertStaffCanAccessStudent(ctx, staff, card.studentId);
    if (card.status !== "draft") throw new ConvexError("report_published");
    const trimmed = args.remarks.trim();
    if (trimmed.length > MAX_REMARKS_LENGTH) {
      throw new ConvexError("invalid_input");
    }
    await ctx.db.patch("reportCards", args.cardId, {
      remarks: trimmed.length > 0 ? trimmed : undefined,
    });
    await logAudit(ctx, {
      actorType: "staff",
      actorId: staff.id,
      action: "report.remarks",
      targetType: "reportCard",
      targetId: args.cardId,
      meta: { studentId: card.studentId },
    });
    return null;
  },
});

/** draft → published + the student's "report" notification (shared). */
async function publishCore(
  ctx: MutationCtx,
  card: Doc<"reportCards">,
  termName: string,
  adminId: string,
): Promise<void> {
  await ctx.db.patch("reportCards", card._id, {
    status: "published",
    publishedAt: Date.now(),
    publishedBy: adminId,
  });
  await notifyStudents(ctx, [card.studentId], {
    type: "report",
    title: `صدر تقرير ${termName}`,
    body: "يمكنك الآن الاطلاع على درجات الفصل وملخص الحضور",
    refType: "report",
    refId: card._id,
  });
}

/** Publish ONE draft card (already published ⇒ "report_published"). */
export const publish = mutation({
  args: { cardId: v.id("reportCards") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const card = await ctx.db.get("reportCards", args.cardId);
    if (!card) throw new ConvexError("not_found");
    if (card.status !== "draft") throw new ConvexError("report_published");
    const term = await ctx.db.get("terms", card.termId);
    await publishCore(ctx, card, term?.name ?? "", admin.id);
    await logAudit(ctx, {
      actorType: "staff",
      actorId: admin.id,
      action: "report.publish",
      targetType: "reportCard",
      targetId: args.cardId,
      meta: { studentId: card.studentId, termId: card.termId },
    });
    return null;
  },
});

/**
 * Publish every remaining draft card of a class+term (same per-student
 * notifications; one audit row for the batch). Returns how many published.
 * No unpublish — a published card is a handed-out document.
 */
export const publishAll = mutation({
  args: { classId: v.id("classes"), termId: v.id("terms") },
  returns: v.number(),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const term = await ctx.db.get("terms", args.termId);
    if (!term) throw new ConvexError("term_not_found");
    const cards = await ctx.db
      .query("reportCards")
      .withIndex("by_classId_and_termId", (q) =>
        q.eq("classId", args.classId).eq("termId", args.termId),
      )
      .take(200);
    let count = 0;
    for (const card of cards) {
      if (card.status !== "draft") continue;
      await publishCore(ctx, card, term.name, admin.id);
      count++;
    }
    await logAudit(ctx, {
      actorType: "staff",
      actorId: admin.id,
      action: "report.publish_all",
      targetType: "class",
      targetId: args.classId,
      meta: { termId: args.termId, count },
    });
    return count;
  },
});

// ——— Student portal (sessionToken) ———

/** The student's own PUBLISHED cards, newest term first. */
export const listForStudent = query({
  args: { sessionToken: v.string() },
  returns: v.array(
    v.object({
      cardId: v.id("reportCards"),
      termId: v.id("terms"),
      termName: v.string(),
      publishedAt: v.optional(v.number()),
      finalAvg: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, args) => {
    const { studentId } = await requireStudentAccount(ctx, args.sessionToken);
    const cards = await ctx.db
      .query("reportCards")
      .withIndex("by_studentId_and_termId", (q) =>
        q.eq("studentId", studentId),
      )
      .take(20);
    const rows: Array<{
      row: {
        cardId: Id<"reportCards">;
        termId: Id<"terms">;
        termName: string;
        publishedAt?: number;
        finalAvg?: number;
      };
      termStart: number;
    }> = [];
    for (const card of cards) {
      if (card.status !== "published") continue; // drafts never leave staff
      const term = await ctx.db.get("terms", card.termId);
      rows.push({
        row: {
          cardId: card._id,
          termId: card.termId,
          termName: term?.name ?? "",
          publishedAt: card.publishedAt,
          finalAvg: finalAvgOf(card),
        },
        termStart: term?.startDate ?? 0,
      });
    }
    rows.sort((a, b) => b.termStart - a.termStart);
    return rows.map((entry) => entry.row);
  },
});

/**
 * One full card for the student's report screen — own + PUBLISHED only; a
 * draft or another student's card is indistinguishable from a missing one.
 */
export const getForStudent = query({
  args: { sessionToken: v.string(), cardId: v.id("reportCards") },
  returns: cardDetailValidator,
  handler: async (ctx, args) => {
    const { studentId } = await requireStudentAccount(ctx, args.sessionToken);
    const card = await ctx.db.get("reportCards", args.cardId);
    if (
      !card ||
      card.studentId !== studentId ||
      card.status !== "published"
    ) {
      throw new ConvexError("not_found");
    }
    return await buildCardDetail(ctx, card);
  },
});
