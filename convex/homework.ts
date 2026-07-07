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
import { awardForHomework } from "./gamification";
import { logAudit } from "./lib/audit";
import { formatDateAr, notifyClass, notifyStudents } from "./lib/notify";
import { homeworkStatus } from "./lib/validators";
import { requireStudentAccount } from "./studentAuth";

/**
 * M9 — homework. A homework is a titled assignment for one (class, subject)
 * with a deadline and a max grade (`marks`). It is live from creation:
 * status "open" → students may submit until the deadline (auto-close
 * scheduled at it, plus a ~24h-before reminder to students who haven't
 * turned anything in) → "closed". One submission row per (homework, student)
 * — resubmitting while open REPLACES its content; the first submission earns
 * the gamification award and is audited. Grading is per submission
 * (0..marks + optional feedback), notifying the student.
 *
 * Staff functions are owner-or-admin; student functions take the bearer
 * `sessionToken` and are scoped to the student's own enrollment/submission.
 *
 * Domain errors use `ConvexError` codes the RTL UI maps to Arabic messages:
 *   not_found · not_assigned · invalid_homework · has_submissions
 *   homework_closed · empty_submission · invalid_submission · invalid_file
 *   invalid_grade
 */

const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 4000;
const MAX_SUBMISSION_TEXT_LENGTH = 8000;
const MAX_FEEDBACK_TEXT_LENGTH = 2000;
const MAX_SUBMISSION_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024; // images / PDFs
const MAX_AUDIO_BYTES = 12 * 1024 * 1024; // voice note
const REMINDER_LEAD_MS = 24 * 60 * 60 * 1000; // reminder fires deadline − 24h
/** No reminder when the whole submission window is shorter than this. */
const REMINDER_MIN_WINDOW_MS = 2 * 60 * 60 * 1000;

const submissionState = v.union(
  v.literal("open_not_submitted"),
  v.literal("open_submitted"),
  v.literal("closed_not_submitted"),
  v.literal("closed_submitted"),
);

// ——— Shared helpers ———

/**
 * Load a homework the caller may act on: admins any, teachers only their
 * own. Missing and not-owned both throw "not_found" so existence never
 * leaks (same pattern as exams.requireExamOwner).
 */
async function requireHomeworkOwner(
  ctx: QueryCtx,
  staff: StaffUser,
  homeworkId: Id<"homework">,
): Promise<Doc<"homework">> {
  const homework = await ctx.db.get("homework", homeworkId);
  if (!homework || (staff.role !== "admin" && homework.teacherId !== staff.id)) {
    throw new ConvexError("not_found");
  }
  return homework;
}

/**
 * Validate + normalize the deadline-independent homework fields. Throws
 * "invalid_homework" on: empty/overlong title, overlong description, marks
 * outside [1, 100]. A whitespace-only description stores as undefined.
 */
function validateHomeworkFields(input: {
  title: string;
  description?: string;
  marks: number;
}): { title: string; description?: string } {
  const title = input.title.trim();
  if (title.length === 0 || title.length > MAX_TITLE_LENGTH) {
    throw new ConvexError("invalid_homework");
  }
  const description = input.description?.trim();
  if (description !== undefined && description.length > MAX_DESCRIPTION_LENGTH) {
    throw new ConvexError("invalid_homework");
  }
  if (
    !Number.isFinite(input.marks) ||
    input.marks < 1 ||
    input.marks > 100
  ) {
    throw new ConvexError("invalid_homework");
  }
  return {
    title,
    description:
      description !== undefined && description.length > 0
        ? description
        : undefined,
  };
}

/** A usable deadline is a finite future timestamp ("invalid_homework"). */
function validateDeadline(deadline: number): void {
  if (!Number.isFinite(deadline) || deadline <= Date.now()) {
    throw new ConvexError("invalid_homework");
  }
}

/**
 * Schedule the homework's lifecycle functions: auto-close exactly at the
 * deadline, and a reminder at max(now + 1min, deadline − 24h) — skipped
 * entirely for windows under 2h, where a "due soon" nudge moments after
 * publishing is just noise.
 */
async function scheduleLifecycle(
  ctx: MutationCtx,
  homeworkId: Id<"homework">,
  deadline: number,
): Promise<{
  closeFnId: Id<"_scheduled_functions">;
  reminderFnId?: Id<"_scheduled_functions">;
}> {
  const closeFnId = await ctx.scheduler.runAt(
    deadline,
    internal.homework.close,
    { homeworkId },
  );
  let reminderFnId: Id<"_scheduled_functions"> | undefined;
  const now = Date.now();
  if (deadline - now >= REMINDER_MIN_WINDOW_MS) {
    reminderFnId = await ctx.scheduler.runAt(
      Math.max(now + 60_000, deadline - REMINDER_LEAD_MS),
      internal.homework.remind,
      { homeworkId },
    );
  }
  return { closeFnId, reminderFnId };
}

/**
 * Shared create path — used by homework.create AND seed.seedHomework so
 * seeded homework gets the exact same lifecycle scheduling and class
 * notification fan-out. Validates fields ("invalid_homework"), inserts the
 * open homework, schedules close + reminder, and notifies the class.
 * Authorization and auditing stay with the callers.
 */
export async function createHomeworkCore(
  ctx: MutationCtx,
  input: {
    teacherId: string;
    classId: Id<"classes">;
    subjectId: Id<"subjects">;
    title: string;
    description?: string;
    deadline: number;
    marks: number;
  },
): Promise<Id<"homework">> {
  const { title, description } = validateHomeworkFields(input);
  validateDeadline(input.deadline);
  const homeworkId = await ctx.db.insert("homework", {
    classId: input.classId,
    subjectId: input.subjectId,
    teacherId: input.teacherId,
    title,
    description,
    deadline: input.deadline,
    marks: input.marks,
    status: "open",
  });
  const { closeFnId, reminderFnId } = await scheduleLifecycle(
    ctx,
    homeworkId,
    input.deadline,
  );
  await ctx.db.patch("homework", homeworkId, { closeFnId, reminderFnId });
  // M5: tell the class. Dates only (Arabic month names, Latin digits) — the
  // exact local time renders client-side.
  await notifyClass(ctx, input.classId, {
    type: "homework",
    title: `واجب جديد: ${title}`,
    body: `آخر موعد للتسليم: ${formatDateAr(input.deadline)}`,
    refType: "homework",
    refId: homeworkId,
  });
  return homeworkId;
}

/** Idempotent close: open → closed (also drops the stale scheduler ids). */
async function closeCore(
  ctx: MutationCtx,
  homework: Doc<"homework">,
): Promise<void> {
  if (homework.status !== "open") return;
  await ctx.db.patch("homework", homework._id, {
    status: "closed",
    closeFnId: undefined,
    reminderFnId: undefined,
  });
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

/** The signed URLs of a submission's attachments (missing files dropped). */
async function resolveAttachments(
  ctx: QueryCtx,
  submission: Doc<"homeworkSubmissions">,
): Promise<{
  files: Array<{ id: Id<"_storage">; url: string }>;
  audioUrl?: string;
}> {
  const files: Array<{ id: Id<"_storage">; url: string }> = [];
  for (const fileId of submission.fileIds) {
    const url = await ctx.storage.getUrl(fileId);
    if (url !== null) files.push({ id: fileId, url });
  }
  const audioUrl =
    submission.audioId !== undefined
      ? ((await ctx.storage.getUrl(submission.audioId)) ?? undefined)
      : undefined;
  return { files, audioUrl };
}

// ——— Staff queries ———

/**
 * The caller's homework (admin: all, optionally narrowed to a class), with
 * joined names and how many of the enrolled students submitted. Sorted by
 * deadline, newest deadline first.
 */
export const listMine = query({
  args: { classId: v.optional(v.id("classes")) },
  returns: v.array(
    v.object({
      _id: v.id("homework"),
      classId: v.id("classes"),
      subjectId: v.id("subjects"),
      title: v.string(),
      description: v.optional(v.string()),
      className: v.string(),
      subjectName: v.string(),
      deadline: v.number(),
      marks: v.number(),
      status: homeworkStatus,
      submittedCount: v.number(),
      enrolledCount: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const staff = await requireTeacher(ctx);
    const classIdFilter = args.classId;
    let homeworkList: Array<Doc<"homework">>;
    if (staff.role === "admin") {
      homeworkList =
        classIdFilter !== undefined
          ? await ctx.db
              .query("homework")
              .withIndex("by_classId", (q) => q.eq("classId", classIdFilter))
              .order("desc")
              .take(200)
          : await ctx.db.query("homework").order("desc").take(200);
    } else {
      const mine = await ctx.db
        .query("homework")
        .withIndex("by_teacherId", (q) => q.eq("teacherId", staff.id))
        .order("desc")
        .take(200);
      homeworkList =
        classIdFilter !== undefined
          ? mine.filter((homework) => homework.classId === classIdFilter)
          : mine;
    }

    const classNames = new Map<Id<"classes">, string>();
    const subjectNames = new Map<Id<"subjects">, string>();
    const enrolledCounts = new Map<Id<"classes">, number>();
    const rows = [];
    for (const homework of homeworkList) {
      const submissions = await ctx.db
        .query("homeworkSubmissions")
        .withIndex("by_homeworkId", (q) => q.eq("homeworkId", homework._id))
        .take(500);
      let enrolledCount = enrolledCounts.get(homework.classId);
      if (enrolledCount === undefined) {
        const enrollments = await ctx.db
          .query("enrollments")
          .withIndex("by_classId_and_active", (q) =>
            q.eq("classId", homework.classId).eq("active", true),
          )
          .take(500);
        enrolledCount = enrollments.length;
        enrolledCounts.set(homework.classId, enrolledCount);
      }
      rows.push({
        _id: homework._id,
        classId: homework.classId,
        subjectId: homework.subjectId,
        title: homework.title,
        description: homework.description,
        className: await cachedName(
          ctx,
          "classes",
          homework.classId,
          classNames,
        ),
        subjectName: await cachedName(
          ctx,
          "subjects",
          homework.subjectId,
          subjectNames,
        ),
        deadline: homework.deadline,
        marks: homework.marks,
        status: homework.status,
        submittedCount: submissions.length,
        enrolledCount,
      });
    }
    rows.sort((a, b) => b.deadline - a.deadline);
    return rows;
  },
});

/**
 * Marking overview (owner-or-admin): the class's active roster LEFT JOINed
 * with this homework's submissions, plus the homework header the page needs.
 */
export const submissions = query({
  args: { homeworkId: v.id("homework") },
  returns: v.object({
    homework: v.object({
      _id: v.id("homework"),
      title: v.string(),
      description: v.optional(v.string()),
      className: v.string(),
      subjectName: v.string(),
      deadline: v.number(),
      marks: v.number(),
      status: homeworkStatus,
    }),
    rows: v.array(
      v.object({
        studentId: v.id("students"),
        studentName: v.string(),
        submissionId: v.optional(v.id("homeworkSubmissions")),
        submittedAt: v.optional(v.number()),
        updatedAt: v.optional(v.number()),
        grade: v.optional(v.number()),
        gradedAt: v.optional(v.number()),
        hasText: v.boolean(),
        fileCount: v.number(),
        hasAudio: v.boolean(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const staff = await requireTeacher(ctx);
    const homework = await requireHomeworkOwner(ctx, staff, args.homeworkId);
    const cls = await ctx.db.get("classes", homework.classId);
    const subject = await ctx.db.get("subjects", homework.subjectId);

    const submissionDocs = await ctx.db
      .query("homeworkSubmissions")
      .withIndex("by_homeworkId", (q) => q.eq("homeworkId", homework._id))
      .take(500);
    const submissionByStudent = new Map<
      Id<"students">,
      Doc<"homeworkSubmissions">
    >();
    for (const submission of submissionDocs) {
      submissionByStudent.set(submission.studentId, submission);
    }

    const enrollments = await ctx.db
      .query("enrollments")
      .withIndex("by_classId_and_active", (q) =>
        q.eq("classId", homework.classId).eq("active", true),
      )
      .take(500);

    const rows = [];
    for (const enrollment of enrollments) {
      const student = await ctx.db.get("students", enrollment.studentId);
      if (!student) continue;
      const submission = submissionByStudent.get(enrollment.studentId);
      rows.push({
        studentId: student._id,
        studentName: `${student.firstName} ${student.lastName}`,
        submissionId: submission?._id,
        submittedAt: submission?.submittedAt,
        updatedAt: submission?.updatedAt,
        grade: submission?.grade,
        gradedAt: submission?.gradedAt,
        hasText: submission?.text !== undefined,
        fileCount: submission?.fileIds.length ?? 0,
        hasAudio: submission?.audioId !== undefined,
      });
    }
    rows.sort((a, b) =>
      a.studentName < b.studentName ? -1 : a.studentName > b.studentName ? 1 : 0,
    );

    return {
      homework: {
        _id: homework._id,
        title: homework.title,
        description: homework.description,
        className: cls?.name ?? "",
        subjectName: subject?.name ?? "",
        deadline: homework.deadline,
        marks: homework.marks,
        status: homework.status,
      },
      rows,
    };
  },
});

/**
 * One submission prepared for the grading screen (owner-or-admin, resolved
 * through the submission's homework): the student's text, signed attachment
 * URLs, the current grade/feedback, plus the header fields.
 */
export const submissionForGrading = query({
  args: { submissionId: v.id("homeworkSubmissions") },
  returns: v.object({
    submissionId: v.id("homeworkSubmissions"),
    homeworkId: v.id("homework"),
    homeworkTitle: v.string(),
    marks: v.number(),
    studentName: v.string(),
    text: v.optional(v.string()),
    files: v.array(v.object({ id: v.id("_storage"), url: v.string() })),
    audioUrl: v.optional(v.string()),
    submittedAt: v.number(),
    updatedAt: v.number(),
    grade: v.optional(v.number()),
    feedbackText: v.optional(v.string()),
    gradedAt: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    const staff = await requireTeacher(ctx);
    const submission = await ctx.db.get(
      "homeworkSubmissions",
      args.submissionId,
    );
    if (!submission) throw new ConvexError("not_found");
    const homework = await requireHomeworkOwner(
      ctx,
      staff,
      submission.homeworkId,
    );
    const student = await ctx.db.get("students", submission.studentId);
    const { files, audioUrl } = await resolveAttachments(ctx, submission);
    return {
      submissionId: submission._id,
      homeworkId: homework._id,
      homeworkTitle: homework.title,
      marks: homework.marks,
      studentName: student
        ? `${student.firstName} ${student.lastName}`
        : "",
      text: submission.text,
      files,
      audioUrl,
      submittedAt: submission.submittedAt,
      updatedAt: submission.updatedAt,
      grade: submission.grade,
      feedbackText: submission.feedbackText,
      gradedAt: submission.gradedAt,
    };
  },
});

// ——— Staff mutations ———

/**
 * Create an OPEN homework for a (class, subject) the caller teaches
 * ("not_assigned" otherwise; admins pass). Live immediately: the class is
 * notified, auto-close is scheduled at the deadline and a reminder ~24h
 * before it.
 */
export const create = mutation({
  args: {
    classId: v.id("classes"),
    subjectId: v.id("subjects"),
    title: v.string(),
    description: v.optional(v.string()),
    deadline: v.number(),
    marks: v.number(),
  },
  returns: v.id("homework"),
  handler: async (ctx, args) => {
    const staff = await requireTeacher(ctx);
    if (staff.role !== "admin") {
      const assignments = await ctx.db
        .query("teacherAssignments")
        .withIndex("by_subjectId_and_classId", (q) =>
          q.eq("subjectId", args.subjectId).eq("classId", args.classId),
        )
        .take(10);
      if (!assignments.some((a) => a.teacherId === staff.id)) {
        throw new ConvexError("not_assigned");
      }
    }
    const homeworkId = await createHomeworkCore(ctx, {
      teacherId: staff.id,
      classId: args.classId,
      subjectId: args.subjectId,
      title: args.title,
      description: args.description,
      deadline: args.deadline,
      marks: args.marks,
    });
    await logAudit(ctx, {
      actorType: "staff",
      actorId: staff.id,
      action: "homework.create",
      targetType: "homework",
      targetId: homeworkId,
      meta: {
        classId: args.classId,
        subjectId: args.subjectId,
        deadline: args.deadline,
        marks: args.marks,
      },
    });
    return homeworkId;
  },
});

/**
 * Edit an OPEN homework (owner-or-admin; closed → "homework_closed").
 * Partial args merge over the stored doc and are revalidated like create.
 * The (class, subject) pairing is fixed at creation — the class was already
 * notified. A deadline change cancels and reschedules both lifecycle
 * functions; the new deadline must be in the future (an unchanged one is
 * not re-checked, so a title fix seconds before closing still lands).
 */
export const update = mutation({
  args: {
    homeworkId: v.id("homework"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    deadline: v.optional(v.number()),
    marks: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await requireTeacher(ctx);
    const homework = await requireHomeworkOwner(ctx, staff, args.homeworkId);
    if (homework.status !== "open") throw new ConvexError("homework_closed");

    const { title, description } = validateHomeworkFields({
      title: args.title ?? homework.title,
      // An explicit empty string clears the description; undefined keeps it.
      description: args.description ?? homework.description,
      marks: args.marks ?? homework.marks,
    });
    const deadline = args.deadline ?? homework.deadline;
    const deadlineChanged = deadline !== homework.deadline;
    if (deadlineChanged) validateDeadline(deadline);

    if (deadlineChanged) {
      if (homework.closeFnId !== undefined) {
        await ctx.scheduler.cancel(homework.closeFnId);
      }
      if (homework.reminderFnId !== undefined) {
        await ctx.scheduler.cancel(homework.reminderFnId);
      }
      const { closeFnId, reminderFnId } = await scheduleLifecycle(
        ctx,
        args.homeworkId,
        deadline,
      );
      await ctx.db.patch("homework", args.homeworkId, {
        title,
        description,
        deadline,
        marks: args.marks ?? homework.marks,
        closeFnId,
        reminderFnId,
      });
    } else {
      await ctx.db.patch("homework", args.homeworkId, {
        title,
        description,
        marks: args.marks ?? homework.marks,
      });
    }
    await logAudit(ctx, {
      actorType: "staff",
      actorId: staff.id,
      action: "homework.update",
      targetType: "homework",
      targetId: args.homeworkId,
      meta: deadlineChanged ? { deadline } : undefined,
    });
    return null;
  },
});

/**
 * Delete a homework nobody has submitted to yet (owner-or-admin;
 * "has_submissions" otherwise — close it instead). Cancels the scheduled
 * lifecycle functions.
 */
export const remove = mutation({
  args: { homeworkId: v.id("homework") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await requireTeacher(ctx);
    const homework = await requireHomeworkOwner(ctx, staff, args.homeworkId);
    const submission = await ctx.db
      .query("homeworkSubmissions")
      .withIndex("by_homeworkId", (q) => q.eq("homeworkId", args.homeworkId))
      .first();
    if (submission) throw new ConvexError("has_submissions");
    if (homework.closeFnId !== undefined) {
      await ctx.scheduler.cancel(homework.closeFnId);
    }
    if (homework.reminderFnId !== undefined) {
      await ctx.scheduler.cancel(homework.reminderFnId);
    }
    await ctx.db.delete("homework", args.homeworkId);
    await logAudit(ctx, {
      actorType: "staff",
      actorId: staff.id,
      action: "homework.delete",
      targetType: "homework",
      targetId: args.homeworkId,
      meta: {
        title: homework.title,
        classId: homework.classId,
        subjectId: homework.subjectId,
      },
    });
    return null;
  },
});

/**
 * Close an open homework early (owner-or-admin; already closed →
 * "homework_closed"): cancels both scheduled functions and flips the status.
 */
export const closeNow = mutation({
  args: { homeworkId: v.id("homework") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await requireTeacher(ctx);
    const homework = await requireHomeworkOwner(ctx, staff, args.homeworkId);
    if (homework.status !== "open") throw new ConvexError("homework_closed");
    if (homework.closeFnId !== undefined) {
      await ctx.scheduler.cancel(homework.closeFnId);
    }
    if (homework.reminderFnId !== undefined) {
      await ctx.scheduler.cancel(homework.reminderFnId);
    }
    await closeCore(ctx, homework);
    await logAudit(ctx, {
      actorType: "staff",
      actorId: staff.id,
      action: "homework.close",
      targetType: "homework",
      targetId: args.homeworkId,
    });
    return null;
  },
});

// ——— Scheduled lifecycle (internal) ———

/** Scheduled at the deadline by create/update. Idempotent. */
export const close = internalMutation({
  args: { homeworkId: v.id("homework") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const homework = await ctx.db.get("homework", args.homeworkId);
    if (!homework) return null;
    await closeCore(ctx, homework);
    return null;
  },
});

/**
 * Scheduled ~24h before the deadline by create/update: nudge every actively
 * enrolled student who hasn't submitted yet. No-op once closed (or deleted).
 */
export const remind = internalMutation({
  args: { homeworkId: v.id("homework") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const homework = await ctx.db.get("homework", args.homeworkId);
    if (!homework || homework.status !== "open") return null;

    const submissionDocs = await ctx.db
      .query("homeworkSubmissions")
      .withIndex("by_homeworkId", (q) => q.eq("homeworkId", args.homeworkId))
      .take(500);
    const submitted = new Set(
      submissionDocs.map((submission) => submission.studentId),
    );
    const enrollments = await ctx.db
      .query("enrollments")
      .withIndex("by_classId_and_active", (q) =>
        q.eq("classId", homework.classId).eq("active", true),
      )
      .take(500);
    const pending = enrollments
      .map((enrollment) => enrollment.studentId)
      .filter((studentId) => !submitted.has(studentId));
    if (pending.length === 0) return null;

    await notifyStudents(ctx, pending, {
      type: "homework",
      title: `تذكير: ${homework.title}`,
      body: `يُغلق التسليم ${formatDateAr(homework.deadline)}`,
      refType: "homework",
      refId: args.homeworkId,
    });
    return null;
  },
});

/**
 * Grade one submission (owner-or-admin): 0 ≤ grade ≤ homework.marks
 * ("invalid_grade" otherwise, also for overlong feedback). Re-grading is
 * allowed and re-stamps gradedAt/gradedBy. Feedback semantics: omitted keeps
 * the existing text, whitespace-only clears it. The student is notified.
 */
export const grade = mutation({
  args: {
    submissionId: v.id("homeworkSubmissions"),
    grade: v.number(),
    feedbackText: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await requireTeacher(ctx);
    const submission = await ctx.db.get(
      "homeworkSubmissions",
      args.submissionId,
    );
    if (!submission) throw new ConvexError("not_found");
    const homework = await requireHomeworkOwner(
      ctx,
      staff,
      submission.homeworkId,
    );
    if (
      !Number.isFinite(args.grade) ||
      args.grade < 0 ||
      args.grade > homework.marks
    ) {
      throw new ConvexError("invalid_grade");
    }
    const feedbackTrimmed = args.feedbackText?.trim();
    if (
      feedbackTrimmed !== undefined &&
      feedbackTrimmed.length > MAX_FEEDBACK_TEXT_LENGTH
    ) {
      throw new ConvexError("invalid_grade");
    }
    const feedbackText =
      args.feedbackText === undefined
        ? submission.feedbackText
        : feedbackTrimmed !== undefined && feedbackTrimmed.length > 0
          ? feedbackTrimmed
          : undefined;

    await ctx.db.patch("homeworkSubmissions", args.submissionId, {
      grade: args.grade,
      feedbackText,
      gradedAt: Date.now(),
      gradedBy: staff.id,
    });
    await logAudit(ctx, {
      actorType: "staff",
      actorId: staff.id,
      action: "homework.grade",
      targetType: "homeworkSubmission",
      targetId: args.submissionId,
      meta: { grade: args.grade },
    });
    await notifyStudents(ctx, [submission.studentId], {
      type: "homework",
      title: `صُحِّح واجبك: ${homework.title}`,
      body: `${args.grade}/${homework.marks}`,
      refType: "homework",
      refId: submission.homeworkId,
    });
    return null;
  },
});

// ——— Student portal (sessionToken) ———

/**
 * The student's homework across their active classes with their own
 * submission state. Open homework first (nearest deadline first), then
 * closed (newest deadline first).
 */
export const listForStudent = query({
  args: { sessionToken: v.string() },
  returns: v.array(
    v.object({
      homeworkId: v.id("homework"),
      title: v.string(),
      subjectName: v.string(),
      deadline: v.number(),
      marks: v.number(),
      status: homeworkStatus,
      state: submissionState,
      grade: v.optional(v.number()),
      gradedAt: v.optional(v.number()),
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

    const subjectNames = new Map<Id<"subjects">, string>();
    const rows: Array<{
      homeworkId: Id<"homework">;
      title: string;
      subjectName: string;
      deadline: number;
      marks: number;
      status: "open" | "closed";
      state:
        | "open_not_submitted"
        | "open_submitted"
        | "closed_not_submitted"
        | "closed_submitted";
      grade?: number;
      gradedAt?: number;
    }> = [];
    for (const enrollment of enrollments) {
      const homeworkList = await ctx.db
        .query("homework")
        .withIndex("by_classId", (q) => q.eq("classId", enrollment.classId))
        .order("desc")
        .take(100);
      for (const homework of homeworkList) {
        const submission = await ctx.db
          .query("homeworkSubmissions")
          .withIndex("by_homeworkId_and_studentId", (q) =>
            q.eq("homeworkId", homework._id).eq("studentId", studentId),
          )
          .unique();
        const state =
          homework.status === "open"
            ? submission
              ? ("open_submitted" as const)
              : ("open_not_submitted" as const)
            : submission
              ? ("closed_submitted" as const)
              : ("closed_not_submitted" as const);
        rows.push({
          homeworkId: homework._id,
          title: homework.title,
          subjectName: await cachedName(
            ctx,
            "subjects",
            homework.subjectId,
            subjectNames,
          ),
          deadline: homework.deadline,
          marks: homework.marks,
          status: homework.status,
          state,
          grade: submission?.grade,
          gradedAt: submission?.gradedAt,
        });
      }
    }
    rows.sort((a, b) => {
      if (a.status !== b.status) return a.status === "open" ? -1 : 1;
      return a.status === "open"
        ? a.deadline - b.deadline
        : b.deadline - a.deadline;
    });
    return rows;
  },
});

/**
 * One homework for the student's detail/submit screen — only for a class
 * the student is actively enrolled in ("not_found" otherwise, so nothing
 * about other classes leaks). Includes the student's own submission (signed
 * attachment URLs WITH their storage ids, so an edit can resend kept files)
 * and whether editing is still possible.
 */
export const getForStudent = query({
  args: { sessionToken: v.string(), homeworkId: v.id("homework") },
  returns: v.object({
    homeworkId: v.id("homework"),
    title: v.string(),
    description: v.optional(v.string()),
    subjectName: v.string(),
    deadline: v.number(),
    marks: v.number(),
    status: homeworkStatus,
    canEdit: v.boolean(),
    submission: v.union(
      v.null(),
      v.object({
        text: v.optional(v.string()),
        files: v.array(v.object({ id: v.id("_storage"), url: v.string() })),
        audioId: v.optional(v.id("_storage")),
        audioUrl: v.optional(v.string()),
        submittedAt: v.number(),
        updatedAt: v.number(),
        grade: v.optional(v.number()),
        feedbackText: v.optional(v.string()),
        gradedAt: v.optional(v.number()),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const { studentId } = await requireStudentAccount(ctx, args.sessionToken);
    const homework = await ctx.db.get("homework", args.homeworkId);
    if (!homework) throw new ConvexError("not_found");
    const enrollments = await ctx.db
      .query("enrollments")
      .withIndex("by_studentId_and_active", (q) =>
        q.eq("studentId", studentId).eq("active", true),
      )
      .take(20);
    if (!enrollments.some((e) => e.classId === homework.classId)) {
      throw new ConvexError("not_found");
    }
    const subject = await ctx.db.get("subjects", homework.subjectId);

    const submissionDoc = await ctx.db
      .query("homeworkSubmissions")
      .withIndex("by_homeworkId_and_studentId", (q) =>
        q.eq("homeworkId", args.homeworkId).eq("studentId", studentId),
      )
      .unique();
    let submission = null;
    if (submissionDoc) {
      const { files, audioUrl } = await resolveAttachments(ctx, submissionDoc);
      submission = {
        text: submissionDoc.text,
        files,
        audioId: submissionDoc.audioId,
        audioUrl,
        submittedAt: submissionDoc.submittedAt,
        updatedAt: submissionDoc.updatedAt,
        grade: submissionDoc.grade,
        feedbackText: submissionDoc.feedbackText,
        gradedAt: submissionDoc.gradedAt,
      };
    }

    return {
      homeworkId: homework._id,
      title: homework.title,
      description: homework.description,
      subjectName: subject?.name ?? "",
      deadline: homework.deadline,
      marks: homework.marks,
      status: homework.status,
      // Evaluated at query time; submit re-checks, so a stale true only
      // yields a clean "homework_closed" error.
      canEdit: homework.status === "open" && Date.now() < homework.deadline,
      submission,
    };
  },
});

/**
 * Submit (or, while still open, RESUBMIT — the content is replaced whole)
 * the student's own homework. At least one of text / files / voice note
 * ("empty_submission"); text ≤8000 chars ("invalid_submission"); ≤5 files,
 * every attachment validated against the _storage metadata: images/PDF
 * ≤10MB, audio ≤12MB ("invalid_file"). The first submission stamps
 * submittedAt, earns the gamification award and is audited; edits only bump
 * updatedAt.
 */
export const submit = mutation({
  args: {
    sessionToken: v.string(),
    homeworkId: v.id("homework"),
    text: v.optional(v.string()),
    fileIds: v.array(v.id("_storage")),
    audioId: v.optional(v.id("_storage")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { studentId, accessCodeId } = await requireStudentAccount(
      ctx,
      args.sessionToken,
    );
    const homework = await ctx.db.get("homework", args.homeworkId);
    if (!homework) throw new ConvexError("not_found");
    const enrollments = await ctx.db
      .query("enrollments")
      .withIndex("by_studentId_and_active", (q) =>
        q.eq("studentId", studentId).eq("active", true),
      )
      .take(20);
    if (!enrollments.some((e) => e.classId === homework.classId)) {
      throw new ConvexError("not_found");
    }
    const now = Date.now();
    if (homework.status !== "open" || now > homework.deadline) {
      throw new ConvexError("homework_closed");
    }

    const trimmed = args.text?.trim();
    if (trimmed !== undefined && trimmed.length > MAX_SUBMISSION_TEXT_LENGTH) {
      throw new ConvexError("invalid_submission");
    }
    const text =
      trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined;

    const fileIds = [...new Set(args.fileIds)];
    if (fileIds.length > MAX_SUBMISSION_FILES) {
      throw new ConvexError("invalid_file");
    }
    if (
      text === undefined &&
      fileIds.length === 0 &&
      args.audioId === undefined
    ) {
      throw new ConvexError("empty_submission");
    }

    // Server-side attachment validation against the _storage metadata: the
    // upload URL mint (files.generateSubmissionUploadUrl) accepts anything,
    // so THIS is the gate — every referenced file must exist and be an
    // image/PDF ≤10MB; the voice note must be audio/* ≤12MB. The 5-minute
    // voice cap is client-enforced; the size limit is the server backstop.
    for (const fileId of fileIds) {
      const metadata = await ctx.db.system.get("_storage", fileId);
      const contentType = metadata?.contentType ?? "";
      if (
        !metadata ||
        metadata.size > MAX_FILE_BYTES ||
        !(
          contentType.startsWith("image/") ||
          contentType.startsWith("application/pdf")
        )
      ) {
        throw new ConvexError("invalid_file");
      }
    }
    if (args.audioId !== undefined) {
      const metadata = await ctx.db.system.get("_storage", args.audioId);
      if (
        !metadata ||
        metadata.size > MAX_AUDIO_BYTES ||
        !(metadata.contentType ?? "").startsWith("audio/")
      ) {
        throw new ConvexError("invalid_file");
      }
    }

    const existing = await ctx.db
      .query("homeworkSubmissions")
      .withIndex("by_homeworkId_and_studentId", (q) =>
        q.eq("homeworkId", args.homeworkId).eq("studentId", studentId),
      )
      .unique();
    if (existing) {
      // Edit: replace the content, keep submittedAt (and any grade — the
      // teacher sees updatedAt > gradedAt and can re-grade).
      await ctx.db.patch("homeworkSubmissions", existing._id, {
        text,
        fileIds,
        audioId: args.audioId,
        updatedAt: now,
      });
      return null;
    }

    const submissionId = await ctx.db.insert("homeworkSubmissions", {
      homeworkId: args.homeworkId,
      studentId,
      text,
      fileIds,
      audioId: args.audioId,
      submittedAt: now,
      updatedAt: now,
    });
    // M6: turning homework in earns points — first submission only (edits
    // never re-award; awardOnce dedupes on the submission id regardless).
    // UTC day key, same convention as attempts.submit.
    await awardForHomework(ctx, {
      studentId,
      submissionId,
      day: new Date(now).toISOString().slice(0, 10),
    });
    await logAudit(ctx, {
      actorType: "student",
      actorId: accessCodeId,
      action: "homework.submit",
      targetType: "homeworkSubmission",
      targetId: submissionId,
      meta: { homeworkId: args.homeworkId },
    });
    return null;
  },
});
