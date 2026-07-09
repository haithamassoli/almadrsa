import { ConvexError, v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireTeacher, type StaffUser } from "./auth";
import { assertStaffCanAccessClass } from "./students";
import { logAudit } from "./lib/audit";
import { cachedName } from "./lib/joins";
import { isValidDateKey, weekdayOf } from "./lib/dates";
import { lessonSource } from "./lib/validators";

/**
 * M3 — lessons: one row per taught period. Timetable slots are materialized
 * into lessons lazily per day (`ensureLessonsForDate`); ad-hoc lessons are
 * created directly. Reads are staff-level; lesson writes are owner-or-admin.
 * Domain errors use `ConvexError` codes the RTL UI maps to Arabic messages:
 *   not_found · invalid_date · invalid_period · not_assigned
 *   too_many_resources · invalid_url · lesson_has_attendance
 */

const MAX_RESOURCES = 10;

const resourceValidator = v.object({ title: v.string(), url: v.string() });

// ——— Shared helpers ———

/**
 * Load a lesson the caller may act on: admins may touch any lesson, teachers
 * only their own. Missing and not-owned both throw "not_found" so existence
 * is never leaked. Shared with convex/attendance.ts.
 */
export async function getOwnedLesson(
  ctx: QueryCtx,
  staff: StaffUser,
  lessonId: Id<"lessons">,
): Promise<Doc<"lessons">> {
  const lesson = await ctx.db.get("lessons", lessonId);
  if (!lesson || (staff.role !== "admin" && lesson.teacherId !== staff.id)) {
    throw new ConvexError("not_found");
  }
  return lesson;
}

// ——— Queries ———

/**
 * The classes the caller teaches (admin: every class), each with the
 * subjects the caller may teach in it (admin: all subjects of the grade).
 * Drives the class/subject pickers of the lessons UI.
 */
export const listMyClasses = query({
  args: {},
  returns: v.array(
    v.object({
      classId: v.id("classes"),
      className: v.string(),
      gradeName: v.string(),
      subjects: v.array(
        v.object({ subjectId: v.id("subjects"), name: v.string() }),
      ),
    }),
  ),
  handler: async (ctx) => {
    const staff = await requireTeacher(ctx);
    const gradeNames = new Map<Id<"grades">, string>();
    const result: Array<{
      classId: Id<"classes">;
      className: string;
      gradeName: string;
      subjects: Array<{ subjectId: Id<"subjects">; name: string }>;
    }> = [];

    if (staff.role === "admin") {
      const classes = await ctx.db.query("classes").take(200);
      const subjectsByGrade = new Map<
        Id<"grades">,
        Array<{ subjectId: Id<"subjects">; name: string }>
      >();
      for (const cls of classes) {
        let subjects = subjectsByGrade.get(cls.gradeId);
        if (subjects === undefined) {
          const rows = await ctx.db
            .query("subjects")
            .withIndex("by_gradeId", (q) => q.eq("gradeId", cls.gradeId))
            .take(100);
          subjects = rows.map((s) => ({ subjectId: s._id, name: s.name }));
          subjectsByGrade.set(cls.gradeId, subjects);
        }
        result.push({
          classId: cls._id,
          className: cls.name,
          gradeName: await cachedName(ctx, "grades", cls.gradeId, gradeNames),
          subjects,
        });
      }
      return result;
    }

    // Teacher: distinct assigned classes, each with ONLY the subjects this
    // teacher is assigned for that class.
    const assignments = await ctx.db
      .query("teacherAssignments")
      .withIndex("by_teacherId", (q) => q.eq("teacherId", staff.id))
      .take(100);
    const subjectIdsByClass = new Map<Id<"classes">, Array<Id<"subjects">>>();
    for (const assignment of assignments) {
      const list = subjectIdsByClass.get(assignment.classId);
      if (list) list.push(assignment.subjectId);
      else subjectIdsByClass.set(assignment.classId, [assignment.subjectId]);
    }
    for (const [classId, subjectIds] of subjectIdsByClass) {
      const cls = await ctx.db.get("classes", classId);
      if (!cls) continue;
      const subjects: Array<{ subjectId: Id<"subjects">; name: string }> = [];
      for (const subjectId of subjectIds) {
        const subject = await ctx.db.get("subjects", subjectId);
        if (subject) subjects.push({ subjectId, name: subject.name });
      }
      result.push({
        classId,
        className: cls.name,
        gradeName: await cachedName(ctx, "grades", cls.gradeId, gradeNames),
        subjects,
      });
    }
    return result;
  },
});

/**
 * The caller's lessons on one day, sorted by period, with attendance
 * progress (marked / enrolled) for the day view.
 */
export const listMine = query({
  args: { date: v.string() },
  returns: v.array(
    v.object({
      _id: v.id("lessons"),
      period: v.number(),
      source: lessonSource,
      title: v.optional(v.string()),
      className: v.string(),
      subjectName: v.string(),
      classId: v.id("classes"),
      markedCount: v.number(),
      enrolledCount: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const staff = await requireTeacher(ctx);
    const lessons = await ctx.db
      .query("lessons")
      .withIndex("by_teacherId_and_date", (q) =>
        q.eq("teacherId", staff.id).eq("date", args.date),
      )
      .take(50);
    lessons.sort((a, b) => a.period - b.period);

    const classNames = new Map<Id<"classes">, string>();
    const subjectNames = new Map<Id<"subjects">, string>();
    const enrolledCounts = new Map<Id<"classes">, number>();
    const result = [];
    for (const lesson of lessons) {
      const marked = await ctx.db
        .query("attendance")
        .withIndex("by_lessonId_and_studentId", (q) =>
          q.eq("lessonId", lesson._id),
        )
        .take(500);
      let enrolledCount = enrolledCounts.get(lesson.classId);
      if (enrolledCount === undefined) {
        const enrollments = await ctx.db
          .query("enrollments")
          .withIndex("by_classId_and_active", (q) =>
            q.eq("classId", lesson.classId).eq("active", true),
          )
          .take(500);
        enrolledCount = enrollments.length;
        enrolledCounts.set(lesson.classId, enrolledCount);
      }
      result.push({
        _id: lesson._id,
        period: lesson.period,
        source: lesson.source,
        title: lesson.title,
        className: await cachedName(ctx, "classes", lesson.classId, classNames),
        subjectName: await cachedName(
          ctx,
          "subjects",
          lesson.subjectId,
          subjectNames,
        ),
        classId: lesson.classId,
        markedCount: marked.length,
        enrolledCount,
      });
    }
    return result;
  },
});

/**
 * A class's lesson history in a date range (newest first) with per-status
 * attendance tallies. Teacher must be assigned to the class; admins pass.
 */
export const listForClass = query({
  args: { classId: v.id("classes"), from: v.string(), to: v.string() },
  returns: v.array(
    v.object({
      _id: v.id("lessons"),
      date: v.string(),
      period: v.number(),
      subjectName: v.string(),
      present: v.number(),
      absent: v.number(),
      late: v.number(),
      total: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const staff = await requireTeacher(ctx);
    await assertStaffCanAccessClass(ctx, staff, args.classId);
    const lessons = await ctx.db
      .query("lessons")
      .withIndex("by_classId_and_date", (q) =>
        q
          .eq("classId", args.classId)
          .gte("date", args.from)
          .lte("date", args.to),
      )
      .order("desc")
      .take(300);

    const subjectNames = new Map<Id<"subjects">, string>();
    const result = [];
    for (const lesson of lessons) {
      const rows = await ctx.db
        .query("attendance")
        .withIndex("by_lessonId_and_studentId", (q) =>
          q.eq("lessonId", lesson._id),
        )
        .take(500);
      let present = 0;
      let absent = 0;
      let late = 0;
      for (const row of rows) {
        if (row.status === "present") present++;
        else if (row.status === "absent") absent++;
        else late++;
      }
      result.push({
        _id: lesson._id,
        date: lesson.date,
        period: lesson.period,
        subjectName: await cachedName(
          ctx,
          "subjects",
          lesson.subjectId,
          subjectNames,
        ),
        present,
        absent,
        late,
        total: present + absent + late,
      });
    }
    return result;
  },
});

/** Full lesson detail (owner-or-admin) for the lesson page. */
export const get = query({
  args: { lessonId: v.id("lessons") },
  returns: v.object({
    _id: v.id("lessons"),
    date: v.string(),
    period: v.number(),
    source: lessonSource,
    title: v.optional(v.string()),
    notes: v.optional(v.string()),
    resources: v.array(resourceValidator),
    className: v.string(),
    subjectName: v.string(),
    classId: v.id("classes"),
  }),
  handler: async (ctx, args) => {
    const staff = await requireTeacher(ctx);
    const lesson = await getOwnedLesson(ctx, staff, args.lessonId);
    const cls = await ctx.db.get("classes", lesson.classId);
    const subject = await ctx.db.get("subjects", lesson.subjectId);
    return {
      _id: lesson._id,
      date: lesson.date,
      period: lesson.period,
      source: lesson.source,
      title: lesson.title,
      notes: lesson.notes,
      resources: lesson.resources,
      className: cls?.name ?? "",
      subjectName: subject?.name ?? "",
      classId: lesson.classId,
    };
  },
});

// ——— Mutations ———

/**
 * Materialize the caller's timetable slots for one day into lesson rows
 * (idempotent — existing rows are kept). Returns how many were created.
 * Routine housekeeping, deliberately not audited.
 */
export const ensureLessonsForDate = mutation({
  args: { date: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    const staff = await requireTeacher(ctx);
    if (!isValidDateKey(args.date)) throw new ConvexError("invalid_date");
    const weekday = weekdayOf(args.date);
    const slots = await ctx.db
      .query("timetableSlots")
      .withIndex("by_teacherId_and_weekday", (q) =>
        q.eq("teacherId", staff.id).eq("weekday", weekday),
      )
      .take(50);
    let created = 0;
    for (const slot of slots) {
      const existing = await ctx.db
        .query("lessons")
        .withIndex("by_timetableSlotId_and_date", (q) =>
          q.eq("timetableSlotId", slot._id).eq("date", args.date),
        )
        .first();
      if (existing) continue;
      await ctx.db.insert("lessons", {
        classId: slot.classId,
        subjectId: slot.subjectId,
        teacherId: slot.teacherId,
        date: args.date,
        period: slot.period,
        source: "timetable",
        timetableSlotId: slot._id,
        resources: [],
      });
      created++;
    }
    return created;
  },
});

/**
 * Create a lesson outside the timetable. Teachers must hold the
 * (subject, class) assignment; admins may create anywhere. The lesson is
 * owned by the caller.
 */
export const createAdHoc = mutation({
  args: {
    classId: v.id("classes"),
    subjectId: v.id("subjects"),
    date: v.string(),
    period: v.number(),
    title: v.optional(v.string()),
  },
  returns: v.id("lessons"),
  handler: async (ctx, args) => {
    const staff = await requireTeacher(ctx);
    if (!isValidDateKey(args.date)) throw new ConvexError("invalid_date");
    if (
      !Number.isInteger(args.period) ||
      args.period < 1 ||
      args.period > 10
    ) {
      throw new ConvexError("invalid_period");
    }
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

    const title = args.title?.trim();
    const lessonId = await ctx.db.insert("lessons", {
      classId: args.classId,
      subjectId: args.subjectId,
      teacherId: staff.id,
      date: args.date,
      period: args.period,
      source: "adhoc",
      title: title !== undefined && title.length > 0 ? title : undefined,
      resources: [],
    });
    await logAudit(ctx, {
      actorType: "staff",
      actorId: staff.id,
      action: "lesson.create",
      targetType: "lesson",
      targetId: lessonId,
      meta: {
        classId: args.classId,
        subjectId: args.subjectId,
        date: args.date,
        period: args.period,
      },
    });
    return lessonId;
  },
});

/**
 * Edit a lesson's content (owner-or-admin). Empty title/notes clear the
 * field; `resources` always replaces the whole list (≤10, http(s) only).
 */
export const updateLesson = mutation({
  args: {
    lessonId: v.id("lessons"),
    title: v.optional(v.string()),
    notes: v.optional(v.string()),
    resources: v.array(resourceValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await requireTeacher(ctx);
    await getOwnedLesson(ctx, staff, args.lessonId);
    if (args.resources.length > MAX_RESOURCES) {
      throw new ConvexError("too_many_resources");
    }
    const resources = args.resources.map((resource) => ({
      title: resource.title.trim(),
      url: resource.url.trim(),
    }));
    for (const resource of resources) {
      if (
        !resource.url.startsWith("http://") &&
        !resource.url.startsWith("https://")
      ) {
        throw new ConvexError("invalid_url");
      }
    }

    const patch: {
      title?: string;
      notes?: string;
      resources: Array<{ title: string; url: string }>;
    } = { resources };
    if (args.title !== undefined) {
      const title = args.title.trim();
      patch.title = title.length > 0 ? title : undefined; // empty clears
    }
    if (args.notes !== undefined) {
      const notes = args.notes.trim();
      patch.notes = notes.length > 0 ? notes : undefined; // empty clears
    }
    await ctx.db.patch("lessons", args.lessonId, patch);
    return null;
  },
});
