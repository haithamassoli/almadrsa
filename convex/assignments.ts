import { ConvexError, v } from "convex/values";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { components } from "./_generated/api";
import { requireAdmin, requireStaff } from "./auth";
import { logAudit } from "./lib/audit";
import { staffRole } from "./lib/validators";

/**
 * M2 — teacher ⇄ (subject, class) assignments. Staff read; admin writes.
 * Teacher identities live in the Better Auth component `user` table and are
 * referenced from `teacherAssignments.teacherId` by the same id the rest of
 * the app uses: `user.userId ?? user._id`. We resolve those ids through the
 * component adapter (never a private import of staff internals).
 */

type BetterAuthUser = {
  _id: string;
  userId?: string | null;
  name?: string | null;
  email?: string | null;
  role?: string | null;
  banned?: boolean | null;
};

/**
 * Resolve a stored `teacherId` back to its Better Auth user row. The id is
 * `userId ?? _id`, so for seed/admin-created staff (userId column null) it is
 * the component `_id` — try a direct `_id` get first, then fall back to the
 * `userId` index. Never throws: an unresolvable id yields null.
 */
async function findStaffUser(
  ctx: QueryCtx | MutationCtx,
  id: string,
): Promise<BetterAuthUser | null> {
  try {
    const byId = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "user",
      where: [{ field: "_id", value: id }],
    });
    if (byId) return byId as BetterAuthUser;
  } catch {
    // `id` was a Better Auth userId string, not a valid component _id.
  }
  const byUserId = await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "user",
    where: [{ field: "userId", value: id }],
  });
  return (byUserId ?? null) as BetterAuthUser | null;
}

type AssignmentRow = {
  _id: Id<"teacherAssignments">;
  teacherId: string;
  teacherName: string;
  subjectId: Id<"subjects">;
  subjectName: string;
  classId: Id<"classes">;
  className: string;
};

export const listAssignments = query({
  args: { classId: v.optional(v.id("classes")) },
  returns: v.array(
    v.object({
      _id: v.id("teacherAssignments"),
      teacherId: v.string(),
      teacherName: v.string(),
      subjectId: v.id("subjects"),
      subjectName: v.string(),
      classId: v.id("classes"),
      className: v.string(),
    }),
  ),
  handler: async (ctx, args): Promise<Array<AssignmentRow>> => {
    await requireStaff(ctx);

    const classId = args.classId;
    const assignments =
      classId !== undefined
        ? await ctx.db
            .query("teacherAssignments")
            .withIndex("by_classId", (q) => q.eq("classId", classId))
            .take(200)
        : await ctx.db.query("teacherAssignments").take(200);

    // Resolve each referenced subject / class / teacher once.
    const subjectNames = new Map<Id<"subjects">, string>();
    const classNames = new Map<Id<"classes">, string>();
    const teacherNames = new Map<string, string>();

    const out: Array<AssignmentRow> = [];
    for (const assignment of assignments) {
      let subjectName = subjectNames.get(assignment.subjectId);
      if (subjectName === undefined) {
        const subject = await ctx.db.get("subjects", assignment.subjectId);
        subjectName = subject?.name ?? "";
        subjectNames.set(assignment.subjectId, subjectName);
      }
      let className = classNames.get(assignment.classId);
      if (className === undefined) {
        const cls = await ctx.db.get("classes", assignment.classId);
        className = cls?.name ?? "";
        classNames.set(assignment.classId, className);
      }
      let teacherName = teacherNames.get(assignment.teacherId);
      if (teacherName === undefined) {
        const user = await findStaffUser(ctx, assignment.teacherId);
        teacherName = user?.name ?? "";
        teacherNames.set(assignment.teacherId, teacherName);
      }
      out.push({
        _id: assignment._id,
        teacherId: assignment.teacherId,
        teacherName,
        subjectId: assignment.subjectId,
        subjectName,
        classId: assignment.classId,
        className,
      });
    }
    return out;
  },
});

export const assignTeacher = mutation({
  args: {
    teacherId: v.string(),
    subjectId: v.id("subjects"),
    classId: v.id("classes"),
  },
  returns: v.id("teacherAssignments"),
  handler: async (ctx, args): Promise<Id<"teacherAssignments">> => {
    const admin = await requireAdmin(ctx);

    const teacher = await findStaffUser(ctx, args.teacherId);
    if (!teacher) throw new ConvexError("teacher_not_found");

    const subject = await ctx.db.get("subjects", args.subjectId);
    if (!subject) throw new ConvexError("subject_not_found");
    const cls = await ctx.db.get("classes", args.classId);
    if (!cls) throw new ConvexError("class_not_found");
    if (subject.gradeId !== cls.gradeId) {
      throw new ConvexError("grade_mismatch");
    }

    // Reject an exact duplicate (same teacher on the same subject+class).
    const sameSubjectClass = await ctx.db
      .query("teacherAssignments")
      .withIndex("by_subjectId_and_classId", (q) =>
        q.eq("subjectId", args.subjectId).eq("classId", args.classId),
      )
      .take(100);
    if (sameSubjectClass.some((a) => a.teacherId === args.teacherId)) {
      throw new ConvexError("already_assigned");
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
      targetType: "teacherAssignment",
      targetId: assignmentId,
      meta: {
        teacherId: args.teacherId,
        subjectId: args.subjectId,
        classId: args.classId,
      },
    });
    return assignmentId;
  },
});

export const unassignTeacher = mutation({
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
      targetType: "teacherAssignment",
      targetId: args.assignmentId,
      meta: {
        teacherId: assignment.teacherId,
        subjectId: assignment.subjectId,
        classId: assignment.classId,
      },
    });
    return null;
  },
});

type TeacherRow = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "teacher";
};

/**
 * Admin-only: every non-banned staff member eligible to hold an assignment.
 * Admins can teach too, so the list is not filtered by role. Mirrors the
 * `staff.listStaff` adapter query rather than importing its internals.
 */
export const listTeachers = query({
  args: {},
  returns: v.array(
    v.object({
      id: v.string(),
      name: v.string(),
      email: v.string(),
      role: staffRole,
    }),
  ),
  handler: async (ctx): Promise<Array<TeacherRow>> => {
    await requireAdmin(ctx);
    const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: "user",
      paginationOpts: { numItems: 200, cursor: null },
      sortBy: { field: "createdAt", direction: "asc" },
    });
    const page = (result?.page ?? []) as Array<BetterAuthUser>;
    return page
      .filter((user) => user.banned !== true)
      .map((user) => ({
        id: user.userId ?? user._id,
        name: user.name ?? "",
        email: user.email ?? "",
        role: user.role === "admin" ? ("admin" as const) : ("teacher" as const),
      }));
  },
});
