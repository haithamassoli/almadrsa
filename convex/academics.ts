import { ConvexError, v } from "convex/values";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { components } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireAdmin, requireTeacher } from "./auth";
import { logAudit } from "./lib/audit";

/**
 * M2 — academic structure: grades, subjects, classes, terms, teacher
 * assignments and per-subject grade weights. Reads require staff (teacher or
 * admin); every write is admin-only. All queries go through indexes and read
 * bounded batches. Business-rule rejections throw `ConvexError` with a short
 * string `data` code so the RTL UI maps them to Arabic messages:
 *   grade_not_found · subject_not_found · class_not_found · term_not_found
 *   assignment_not_found · grade_not_empty · subject_in_use · class_not_empty
 *   term_dates · term_is_active · assignment_duplicate
 *   assignment_grade_mismatch · assignment_teacher_invalid · weights_sum
 *   invalid_input
 */

// ——— Shared helpers ———

/** Trimmed, non-empty user-supplied name. */
function cleanName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new ConvexError("invalid_input");
  return trimmed;
}

// Reject NaN / ±Infinity on client-supplied numeric fields before they reach
// the DB and corrupt ordering or date logic.
function assertFinite(value: number, code: string): void {
  if (!Number.isFinite(value)) throw new ConvexError(code);
}

type AuthUserRow = {
  _id: string;
  userId?: string | null;
  name?: string | null;
  email?: string | null;
  role?: string | null;
  banned?: boolean | null;
};

/**
 * Bounded read of the Better Auth user table (same pattern as
 * staff.listStaff). Staff ids in app tables are `userId ?? _id`.
 */
async function listAuthUsers(
  ctx: QueryCtx | MutationCtx,
): Promise<Array<AuthUserRow>> {
  const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: "user",
    paginationOpts: { numItems: 200, cursor: null },
    sortBy: { field: "createdAt", direction: "asc" },
  });
  return (result?.page ?? []) as Array<AuthUserRow>;
}

// ——— Contract queries (staff-level reads, used across admin/teacher UIs) ———

export const listGrades = query({
  args: {},
  returns: v.array(
    v.object({ _id: v.id("grades"), name: v.string(), order: v.number() }),
  ),
  handler: async (ctx) => {
    await requireTeacher(ctx);
    const grades = await ctx.db
      .query("grades")
      .withIndex("by_order")
      .order("asc")
      .take(200);
    return grades.map((g) => ({ _id: g._id, name: g.name, order: g.order }));
  },
});

export const listAllClasses = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("classes"),
      name: v.string(),
      gradeId: v.id("grades"),
      gradeName: v.string(),
    }),
  ),
  handler: async (ctx) => {
    await requireTeacher(ctx);
    const classes = await ctx.db.query("classes").take(300);
    const gradeNames = new Map<Id<"grades">, string>();
    const result = [];
    for (const cls of classes) {
      let gradeName = gradeNames.get(cls.gradeId);
      if (gradeName === undefined) {
        const grade = await ctx.db.get("grades", cls.gradeId);
        gradeName = grade?.name ?? "";
        gradeNames.set(cls.gradeId, gradeName);
      }
      result.push({
        _id: cls._id,
        name: cls.name,
        gradeId: cls.gradeId,
        gradeName,
      });
    }
    return result;
  },
});

export const listClassesByGrade = query({
  args: { gradeId: v.id("grades") },
  returns: v.array(v.object({ _id: v.id("classes"), name: v.string() })),
  handler: async (ctx, args) => {
    await requireTeacher(ctx);
    const classes = await ctx.db
      .query("classes")
      .withIndex("by_gradeId", (q) => q.eq("gradeId", args.gradeId))
      .take(200);
    return classes.map((c) => ({ _id: c._id, name: c.name }));
  },
});

export const listSubjectsByGrade = query({
  args: { gradeId: v.id("grades") },
  returns: v.array(v.object({ _id: v.id("subjects"), name: v.string() })),
  handler: async (ctx, args) => {
    await requireTeacher(ctx);
    const subjects = await ctx.db
      .query("subjects")
      .withIndex("by_gradeId", (q) => q.eq("gradeId", args.gradeId))
      .take(200);
    return subjects.map((s) => ({ _id: s._id, name: s.name }));
  },
});

// ——— Grades CRUD (admin) ———

export const createGrade = mutation({
  args: { name: v.string(), order: v.number() },
  returns: v.id("grades"),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    assertFinite(args.order, "invalid_input");
    return await ctx.db.insert("grades", {
      name: cleanName(args.name),
      order: args.order,
    });
  },
});

export const updateGrade = mutation({
  args: { gradeId: v.id("grades"), name: v.string(), order: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const grade = await ctx.db.get("grades", args.gradeId);
    if (!grade) throw new ConvexError("grade_not_found");
    assertFinite(args.order, "invalid_input");
    await ctx.db.patch("grades", args.gradeId, {
      name: cleanName(args.name),
      order: args.order,
    });
    return null;
  },
});

export const deleteGrade = mutation({
  args: { gradeId: v.id("grades") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const grade = await ctx.db.get("grades", args.gradeId);
    if (!grade) throw new ConvexError("grade_not_found");

    const subject = await ctx.db
      .query("subjects")
      .withIndex("by_gradeId", (q) => q.eq("gradeId", args.gradeId))
      .first();
    if (subject) throw new ConvexError("grade_not_empty");
    const cls = await ctx.db
      .query("classes")
      .withIndex("by_gradeId", (q) => q.eq("gradeId", args.gradeId))
      .first();
    if (cls) throw new ConvexError("grade_not_empty");

    await ctx.db.delete("grades", args.gradeId);
    await logAudit(ctx, {
      actorType: "staff",
      actorId: admin.id,
      action: "structure.delete",
      targetType: "grade",
      targetId: args.gradeId,
      meta: { name: grade.name },
    });
    return null;
  },
});

// ——— Subjects CRUD (admin) ———

export const createSubject = mutation({
  args: { name: v.string(), gradeId: v.id("grades") },
  returns: v.id("subjects"),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const grade = await ctx.db.get("grades", args.gradeId);
    if (!grade) throw new ConvexError("grade_not_found");
    return await ctx.db.insert("subjects", {
      name: cleanName(args.name),
      gradeId: args.gradeId,
    });
  },
});

export const updateSubject = mutation({
  args: { subjectId: v.id("subjects"), name: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const subject = await ctx.db.get("subjects", args.subjectId);
    if (!subject) throw new ConvexError("subject_not_found");
    await ctx.db.patch("subjects", args.subjectId, {
      name: cleanName(args.name),
    });
    return null;
  },
});

export const deleteSubject = mutation({
  args: { subjectId: v.id("subjects") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const subject = await ctx.db.get("subjects", args.subjectId);
    if (!subject) throw new ConvexError("subject_not_found");

    // Teacher assignments referencing this subject block deletion (prefix
    // scan of the composite index).
    const assignment = await ctx.db
      .query("teacherAssignments")
      .withIndex("by_subjectId_and_classId", (q) =>
        q.eq("subjectId", args.subjectId),
      )
      .first();
    if (assignment) throw new ConvexError("subject_in_use");

    // Weights are subordinate config — cascade the (at most one) row.
    const weights = await ctx.db
      .query("gradeWeights")
      .withIndex("by_subjectId", (q) => q.eq("subjectId", args.subjectId))
      .take(10);
    for (const row of weights) {
      await ctx.db.delete("gradeWeights", row._id);
    }

    await ctx.db.delete("subjects", args.subjectId);
    await logAudit(ctx, {
      actorType: "staff",
      actorId: admin.id,
      action: "structure.delete",
      targetType: "subject",
      targetId: args.subjectId,
      meta: { name: subject.name },
    });
    return null;
  },
});

// ——— Classes CRUD (admin) ———

export const createClass = mutation({
  args: { name: v.string(), gradeId: v.id("grades") },
  returns: v.id("classes"),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const grade = await ctx.db.get("grades", args.gradeId);
    if (!grade) throw new ConvexError("grade_not_found");
    return await ctx.db.insert("classes", {
      name: cleanName(args.name),
      gradeId: args.gradeId,
    });
  },
});

export const updateClass = mutation({
  args: { classId: v.id("classes"), name: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const cls = await ctx.db.get("classes", args.classId);
    if (!cls) throw new ConvexError("class_not_found");
    await ctx.db.patch("classes", args.classId, {
      name: cleanName(args.name),
    });
    return null;
  },
});

export const deleteClass = mutation({
  args: { classId: v.id("classes") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const cls = await ctx.db.get("classes", args.classId);
    if (!cls) throw new ConvexError("class_not_found");

    // Active enrollments block deletion.
    const enrollment = await ctx.db
      .query("enrollments")
      .withIndex("by_classId_and_active", (q) =>
        q.eq("classId", args.classId).eq("active", true),
      )
      .first();
    if (enrollment) throw new ConvexError("class_not_empty");

    // Teacher assignments are subordinate — cascade in bounded batches.
    for (;;) {
      const assignments = await ctx.db
        .query("teacherAssignments")
        .withIndex("by_classId", (q) => q.eq("classId", args.classId))
        .take(200);
      for (const row of assignments) {
        await ctx.db.delete("teacherAssignments", row._id);
      }
      if (assignments.length < 200) break;
    }

    await ctx.db.delete("classes", args.classId);
    await logAudit(ctx, {
      actorType: "staff",
      actorId: admin.id,
      action: "structure.delete",
      targetType: "class",
      targetId: args.classId,
      meta: { name: cls.name },
    });
    return null;
  },
});

// ——— Terms (admin writes) ———

export const listTerms = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("terms"),
      name: v.string(),
      startDate: v.number(),
      endDate: v.number(),
      active: v.boolean(),
    }),
  ),
  handler: async (ctx) => {
    await requireTeacher(ctx);
    const terms = await ctx.db.query("terms").order("desc").take(100);
    return terms.map((t) => ({
      _id: t._id,
      name: t.name,
      startDate: t.startDate,
      endDate: t.endDate,
      active: t.active,
    }));
  },
});

export const createTerm = mutation({
  args: { name: v.string(), startDate: v.number(), endDate: v.number() },
  returns: v.id("terms"),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    assertFinite(args.startDate, "term_dates");
    assertFinite(args.endDate, "term_dates");
    if (!(args.startDate < args.endDate)) throw new ConvexError("term_dates");
    // New terms are created inactive; activation goes through setActiveTerm
    // so the single-active invariant is never broken here.
    return await ctx.db.insert("terms", {
      name: cleanName(args.name),
      startDate: args.startDate,
      endDate: args.endDate,
      active: false,
    });
  },
});

export const updateTerm = mutation({
  args: {
    termId: v.id("terms"),
    name: v.string(),
    startDate: v.number(),
    endDate: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const term = await ctx.db.get("terms", args.termId);
    if (!term) throw new ConvexError("term_not_found");
    assertFinite(args.startDate, "term_dates");
    assertFinite(args.endDate, "term_dates");
    if (!(args.startDate < args.endDate)) throw new ConvexError("term_dates");
    await ctx.db.patch("terms", args.termId, {
      name: cleanName(args.name),
      startDate: args.startDate,
      endDate: args.endDate,
    });
    return null;
  },
});

export const deleteTerm = mutation({
  args: { termId: v.id("terms") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const term = await ctx.db.get("terms", args.termId);
    if (!term) throw new ConvexError("term_not_found");
    // Never silently drop the single active term — deactivate first.
    if (term.active) throw new ConvexError("term_is_active");
    await ctx.db.delete("terms", args.termId);
    await logAudit(ctx, {
      actorType: "staff",
      actorId: admin.id,
      action: "structure.delete",
      targetType: "term",
      targetId: args.termId,
      meta: { name: term.name },
    });
    return null;
  },
});

export const setActiveTerm = mutation({
  args: { termId: v.id("terms") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const target = await ctx.db.get("terms", args.termId);
    if (!target) throw new ConvexError("term_not_found");

    // Exactly one active term: flip everyone else off, this one on. Terms
    // are a small set (≤100); patch only rows whose flag actually changes.
    const terms = await ctx.db.query("terms").take(100);
    for (const term of terms) {
      const active = term._id === args.termId;
      if (term.active !== active) {
        await ctx.db.patch("terms", term._id, { active });
      }
    }
    await logAudit(ctx, {
      actorType: "staff",
      actorId: admin.id,
      action: "term.set_active",
      targetType: "term",
      targetId: args.termId,
      meta: { name: target.name },
    });
    return null;
  },
});

// ——— Teacher assignments ———

export const listAssignments = query({
  args: { classId: v.id("classes") },
  returns: v.array(
    v.object({
      _id: v.id("teacherAssignments"),
      teacherId: v.string(),
      teacherName: v.string(),
      subjectId: v.id("subjects"),
      subjectName: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireTeacher(ctx);
    const rows = await ctx.db
      .query("teacherAssignments")
      .withIndex("by_classId", (q) => q.eq("classId", args.classId))
      .take(200);
    if (rows.length === 0) return [];

    // Teacher names live in the Better Auth component — one bounded read,
    // then join in memory.
    const users = await listAuthUsers(ctx);
    const nameById = new Map<string, string>();
    for (const user of users) {
      nameById.set(user.userId ?? user._id, user.name ?? user.email ?? "");
    }
    const subjectNames = new Map<Id<"subjects">, string>();
    const result = [];
    for (const row of rows) {
      let subjectName = subjectNames.get(row.subjectId);
      if (subjectName === undefined) {
        const subject = await ctx.db.get("subjects", row.subjectId);
        subjectName = subject?.name ?? "";
        subjectNames.set(row.subjectId, subjectName);
      }
      result.push({
        _id: row._id,
        teacherId: row.teacherId,
        teacherName: nameById.get(row.teacherId) ?? row.teacherId,
        subjectId: row.subjectId,
        subjectName,
      });
    }
    return result;
  },
});

export const createAssignment = mutation({
  args: {
    teacherId: v.string(),
    subjectId: v.id("subjects"),
    classId: v.id("classes"),
  },
  returns: v.id("teacherAssignments"),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const subject = await ctx.db.get("subjects", args.subjectId);
    if (!subject) throw new ConvexError("subject_not_found");
    const cls = await ctx.db.get("classes", args.classId);
    if (!cls) throw new ConvexError("class_not_found");
    if (subject.gradeId !== cls.gradeId) {
      throw new ConvexError("assignment_grade_mismatch");
    }

    // One teacher per subject per class.
    const existing = await ctx.db
      .query("teacherAssignments")
      .withIndex("by_subjectId_and_classId", (q) =>
        q.eq("subjectId", args.subjectId).eq("classId", args.classId),
      )
      .first();
    if (existing) throw new ConvexError("assignment_duplicate");

    // The assignee must be an existing, non-banned teacher account (admins
    // are not assignable).
    const users = await listAuthUsers(ctx);
    const teacher = users.find((u) => (u.userId ?? u._id) === args.teacherId);
    if (!teacher || teacher.banned === true || teacher.role === "admin") {
      throw new ConvexError("assignment_teacher_invalid");
    }

    const assignmentId = await ctx.db.insert("teacherAssignments", {
      teacherId: args.teacherId,
      subjectId: args.subjectId,
      classId: args.classId,
    });
    await logAudit(ctx, {
      actorType: "staff",
      actorId: admin.id,
      action: "assignment.create",
      targetType: "staffUser",
      targetId: args.teacherId,
      meta: { subjectId: args.subjectId, classId: args.classId },
    });
    return assignmentId;
  },
});

export const deleteAssignment = mutation({
  args: { assignmentId: v.id("teacherAssignments") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const assignment = await ctx.db.get(
      "teacherAssignments",
      args.assignmentId,
    );
    if (!assignment) throw new ConvexError("assignment_not_found");
    await ctx.db.delete("teacherAssignments", args.assignmentId);
    await logAudit(ctx, {
      actorType: "staff",
      actorId: admin.id,
      action: "assignment.delete",
      targetType: "staffUser",
      targetId: assignment.teacherId,
      meta: {
        subjectId: assignment.subjectId,
        classId: assignment.classId,
      },
    });
    return null;
  },
});

// ——— Grade weights ———

export const getWeights = query({
  args: { subjectId: v.id("subjects") },
  returns: v.union(
    v.null(),
    v.object({
      examsPct: v.number(),
      homeworkPct: v.number(),
      participationPct: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireTeacher(ctx);
    const weights = await ctx.db
      .query("gradeWeights")
      .withIndex("by_subjectId", (q) => q.eq("subjectId", args.subjectId))
      .first();
    if (!weights) return null;
    return {
      examsPct: weights.examsPct,
      homeworkPct: weights.homeworkPct,
      participationPct: weights.participationPct,
    };
  },
});

export const setWeights = mutation({
  args: {
    subjectId: v.id("subjects"),
    examsPct: v.number(),
    homeworkPct: v.number(),
    participationPct: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    // Each part must be a non-negative integer (Number.isInteger also
    // rejects NaN / ±Infinity) and the three must sum to exactly 100.
    const parts = [args.examsPct, args.homeworkPct, args.participationPct];
    for (const pct of parts) {
      if (!Number.isInteger(pct) || pct < 0) {
        throw new ConvexError("weights_sum");
      }
    }
    if (args.examsPct + args.homeworkPct + args.participationPct !== 100) {
      throw new ConvexError("weights_sum");
    }

    const subject = await ctx.db.get("subjects", args.subjectId);
    if (!subject) throw new ConvexError("subject_not_found");

    const existing = await ctx.db
      .query("gradeWeights")
      .withIndex("by_subjectId", (q) => q.eq("subjectId", args.subjectId))
      .first();
    const next = {
      examsPct: args.examsPct,
      homeworkPct: args.homeworkPct,
      participationPct: args.participationPct,
    };
    const before = existing
      ? {
          examsPct: existing.examsPct,
          homeworkPct: existing.homeworkPct,
          participationPct: existing.participationPct,
        }
      : null;
    if (existing) {
      await ctx.db.patch("gradeWeights", existing._id, next);
    } else {
      await ctx.db.insert("gradeWeights", {
        subjectId: args.subjectId,
        ...next,
      });
    }
    // PRD: grade/weight changes are audited (they redefine every student's
    // computed subject grade).
    await logAudit(ctx, {
      actorType: "staff",
      actorId: admin.id,
      action: "weights.set",
      targetType: "subject",
      targetId: args.subjectId,
      meta: { before, after: next },
    });
    return null;
  },
});

/** Weights page helper: every subject of a grade with its (optional) weights. */
export const listWeightsForGrade = query({
  args: { gradeId: v.id("grades") },
  returns: v.array(
    v.object({
      subjectId: v.id("subjects"),
      subjectName: v.string(),
      examsPct: v.optional(v.number()),
      homeworkPct: v.optional(v.number()),
      participationPct: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, args) => {
    await requireTeacher(ctx);
    const subjects = await ctx.db
      .query("subjects")
      .withIndex("by_gradeId", (q) => q.eq("gradeId", args.gradeId))
      .take(100);
    const out: Array<{
      subjectId: Id<"subjects">;
      subjectName: string;
      examsPct?: number;
      homeworkPct?: number;
      participationPct?: number;
    }> = [];
    for (const subject of subjects) {
      const weights = await ctx.db
        .query("gradeWeights")
        .withIndex("by_subjectId", (q) => q.eq("subjectId", subject._id))
        .first();
      out.push({
        subjectId: subject._id,
        subjectName: subject.name,
        examsPct: weights?.examsPct,
        homeworkPct: weights?.homeworkPct,
        participationPct: weights?.participationPct,
      });
    }
    return out;
  },
});
