import { ConvexError, v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireTeacher, type StaffUser } from "./auth";
import { logAudit } from "./lib/audit";
import { cachedName } from "./lib/joins";
import { assertStaffCanAccessClass } from "./students";
import { requireStudentAccount } from "./studentAuth";

/**
 * M14 — digital library. A resource is a titled http(s) link attached to a
 * subject and owned by the staff member who added it. `classId` narrows it
 * to one class; undefined shares it with every class of the subject's grade
 * (the student portal merges both scopes). Staff reads are teacher-level
 * (teachers see their own rows, admins everything); writes are
 * owner-or-admin; student reads take the bearer `sessionToken` and are
 * scoped to the student's own active enrollment(s).
 *
 * Domain errors use `ConvexError` codes the RTL UI maps to Arabic messages:
 *   not_found · not_assigned · invalid_resource
 */

const MAX_TITLE_LENGTH = 200;
const MAX_URL_LENGTH = 2048; // defensive doc-size bound, same failure code

// ——— Shared helpers ———

/**
 * Load a resource the caller may act on: admins any, teachers only their
 * own. Missing and not-owned both throw "not_found" so existence never
 * leaks (same pattern as exams.requireExamOwner).
 */
async function getOwnedResource(
  ctx: QueryCtx,
  staff: StaffUser,
  resourceId: Id<"libraryResources">,
): Promise<Doc<"libraryResources">> {
  const resource = await ctx.db.get("libraryResources", resourceId);
  if (
    !resource ||
    (staff.role !== "admin" && resource.teacherId !== staff.id)
  ) {
    throw new ConvexError("not_found");
  }
  return resource;
}

/**
 * Admin passes. Teacher must hold a teacherAssignments row for the subject
 * in SOME class — a subject teacher may share material grade-wide.
 * (Replicated from convex/questions.ts, which does not export its M4
 * helper; this file must not edit questions.ts.)
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

/**
 * Shared create/update target authorization: the subject must exist
 * ("not_found"), non-admins need an assignment for it in some class
 * ("not_assigned"), and a given classId must name an existing class the
 * caller can access.
 */
async function assertCanPlaceResource(
  ctx: QueryCtx,
  staff: StaffUser,
  subjectId: Id<"subjects">,
  classId: Id<"classes"> | undefined,
): Promise<void> {
  const subject = await ctx.db.get("subjects", subjectId);
  if (!subject) throw new ConvexError("not_found");
  await assertStaffCanAccessSubject(ctx, staff, subjectId);
  if (classId !== undefined) {
    const cls = await ctx.db.get("classes", classId);
    if (!cls) throw new ConvexError("not_found");
    await assertStaffCanAccessClass(ctx, staff, classId);
  }
}

/**
 * Trim + validate the user-supplied fields ("invalid_resource"): title
 * 1–200 chars; url http(s) only and ≤2048 chars.
 */
function normalizeResourceInput(input: { title: string; url: string }): {
  title: string;
  url: string;
} {
  const title = input.title.trim();
  if (title.length === 0 || title.length > MAX_TITLE_LENGTH) {
    throw new ConvexError("invalid_resource");
  }
  const url = input.url.trim();
  if (
    url.length > MAX_URL_LENGTH ||
    (!url.startsWith("http://") && !url.startsWith("https://"))
  ) {
    throw new ConvexError("invalid_resource");
  }
  return { title, url };
}

// ——— Staff queries ———

/**
 * The staff library listing, newest first, with joined names. Teachers see
 * their OWN resources (newest 200, optional filters applied in memory);
 * admins see everything, narrowed by one index when a filter is given
 * (classId wins over subjectId; the other filter applies in memory).
 * All scans capped at 200 rows.
 */
export const listForStaff = query({
  args: {
    classId: v.optional(v.id("classes")),
    subjectId: v.optional(v.id("subjects")),
  },
  returns: v.array(
    v.object({
      _id: v.id("libraryResources"),
      title: v.string(),
      url: v.string(),
      subjectId: v.id("subjects"),
      classId: v.optional(v.id("classes")),
      teacherId: v.string(),
      subjectName: v.string(),
      className: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const staff = await requireTeacher(ctx);
    let resources: Array<Doc<"libraryResources">>;
    if (staff.role !== "admin") {
      // Teacher: newest 200 own rows; filters below run in memory.
      resources = await ctx.db
        .query("libraryResources")
        .withIndex("by_teacherId", (q) => q.eq("teacherId", staff.id))
        .order("desc")
        .take(200);
    } else if (args.classId !== undefined) {
      const classId = args.classId;
      resources = await ctx.db
        .query("libraryResources")
        .withIndex("by_classId", (q) => q.eq("classId", classId))
        .order("desc")
        .take(200);
    } else if (args.subjectId !== undefined) {
      const subjectId = args.subjectId;
      resources = await ctx.db
        .query("libraryResources")
        .withIndex("by_subjectId", (q) => q.eq("subjectId", subjectId))
        .order("desc")
        .take(200);
    } else {
      resources = await ctx.db
        .query("libraryResources")
        .order("desc")
        .take(200);
    }
    // In-memory narrowing: covers the teacher branch and an admin's second
    // filter; a no-op for whatever the index already pinned.
    const filtered = resources.filter(
      (resource) =>
        (args.classId === undefined || resource.classId === args.classId) &&
        (args.subjectId === undefined ||
          resource.subjectId === args.subjectId),
    );

    const subjectNames = new Map<Id<"subjects">, string>();
    const classNames = new Map<Id<"classes">, string>();
    const rows = [];
    for (const resource of filtered) {
      rows.push({
        _id: resource._id,
        title: resource.title,
        url: resource.url,
        subjectId: resource.subjectId,
        classId: resource.classId,
        teacherId: resource.teacherId,
        subjectName: await cachedName(
          ctx,
          "subjects",
          resource.subjectId,
          subjectNames,
        ),
        className:
          resource.classId !== undefined
            ? await cachedName(ctx, "classes", resource.classId, classNames)
            : undefined,
      });
    }
    return rows;
  },
});

// ——— Staff mutations ———

/**
 * Add a resource for a subject the caller teaches (in any class —
 * "not_assigned" otherwise; admins pass). A given classId narrows it to
 * that class and additionally requires class access; omitted = whole-grade.
 */
export const create = mutation({
  args: {
    title: v.string(),
    url: v.string(),
    subjectId: v.id("subjects"),
    classId: v.optional(v.id("classes")),
  },
  returns: v.id("libraryResources"),
  handler: async (ctx, args) => {
    const staff = await requireTeacher(ctx);
    await assertCanPlaceResource(ctx, staff, args.subjectId, args.classId);
    const { title, url } = normalizeResourceInput(args);
    const resourceId = await ctx.db.insert("libraryResources", {
      title,
      url,
      subjectId: args.subjectId,
      classId: args.classId,
      teacherId: staff.id,
    });
    await logAudit(ctx, {
      actorType: "staff",
      actorId: staff.id,
      action: "library.create",
      targetType: "libraryResource",
      targetId: resourceId,
      meta: {
        subjectId: args.subjectId,
        ...(args.classId !== undefined ? { classId: args.classId } : {}),
      },
    });
    return resourceId;
  },
});

/**
 * Edit a resource (owner-or-admin) — a full replacement of the same fields
 * create takes, revalidated identically. An omitted classId widens the
 * resource back to whole-grade.
 */
export const update = mutation({
  args: {
    resourceId: v.id("libraryResources"),
    title: v.string(),
    url: v.string(),
    subjectId: v.id("subjects"),
    classId: v.optional(v.id("classes")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await requireTeacher(ctx);
    await getOwnedResource(ctx, staff, args.resourceId);
    await assertCanPlaceResource(ctx, staff, args.subjectId, args.classId);
    const { title, url } = normalizeResourceInput(args);
    await ctx.db.patch("libraryResources", args.resourceId, {
      title,
      url,
      subjectId: args.subjectId,
      classId: args.classId, // undefined clears back to whole-grade
    });
    return null;
  },
});

/** Delete a resource (owner-or-admin). */
export const remove = mutation({
  args: { resourceId: v.id("libraryResources") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await requireTeacher(ctx);
    const resource = await getOwnedResource(ctx, staff, args.resourceId);
    await ctx.db.delete("libraryResources", args.resourceId);
    await logAudit(ctx, {
      actorType: "staff",
      actorId: staff.id,
      action: "library.delete",
      targetType: "libraryResource",
      targetId: args.resourceId,
      meta: {
        title: resource.title,
        subjectId: resource.subjectId,
        ...(resource.classId !== undefined
          ? { classId: resource.classId }
          : {}),
      },
    });
    return null;
  },
});

// ——— Student portal (sessionToken) ———

/**
 * The student's library: resources narrowed to one of their active classes
 * PLUS whole-grade resources of their grade's subjects, deduped and merged
 * newest-first. Caps: ≤20 enrollments · ≤100 class-scoped rows per class ·
 * ≤100 subjects per grade × newest 100 rows per subject · 100 rows out.
 */
export const listForStudent = query({
  args: { sessionToken: v.string() },
  returns: v.array(
    v.object({
      _id: v.id("libraryResources"),
      title: v.string(),
      url: v.string(),
      subjectName: v.string(),
      className: v.optional(v.string()),
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

    // Dedupe by id: two active classes in the same grade would otherwise
    // repeat that grade's whole-grade rows.
    const byId = new Map<Id<"libraryResources">, Doc<"libraryResources">>();
    const seenGrades = new Set<Id<"grades">>();
    for (const enrollment of enrollments) {
      // Class-scoped resources of this class (newest 100).
      const classRows = await ctx.db
        .query("libraryResources")
        .withIndex("by_classId", (q) => q.eq("classId", enrollment.classId))
        .order("desc")
        .take(100);
      for (const resource of classRows) byId.set(resource._id, resource);

      // Whole-grade resources: every subject of the class's grade (≤100),
      // newest 100 rows each, kept only when not narrowed to a class.
      const cls = await ctx.db.get("classes", enrollment.classId);
      if (!cls || seenGrades.has(cls.gradeId)) continue;
      seenGrades.add(cls.gradeId);
      const subjects = await ctx.db
        .query("subjects")
        .withIndex("by_gradeId", (q) => q.eq("gradeId", cls.gradeId))
        .take(100);
      for (const subject of subjects) {
        const subjectRows = await ctx.db
          .query("libraryResources")
          .withIndex("by_subjectId", (q) => q.eq("subjectId", subject._id))
          .order("desc")
          .take(100);
        for (const resource of subjectRows) {
          if (resource.classId === undefined) {
            byId.set(resource._id, resource);
          }
        }
      }
    }

    const merged = [...byId.values()]
      .sort((a, b) => b._creationTime - a._creationTime)
      .slice(0, 100);

    const subjectNames = new Map<Id<"subjects">, string>();
    const classNames = new Map<Id<"classes">, string>();
    const rows = [];
    for (const resource of merged) {
      rows.push({
        _id: resource._id,
        title: resource.title,
        url: resource.url,
        subjectName: await cachedName(
          ctx,
          "subjects",
          resource.subjectId,
          subjectNames,
        ),
        className:
          resource.classId !== undefined
            ? await cachedName(ctx, "classes", resource.classId, classNames)
            : undefined,
      });
    }
    return rows;
  },
});
