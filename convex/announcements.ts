import { ConvexError, v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAdmin, requireTeacher } from "./auth";
import { requireStudentAccount } from "./studentAuth";
import { assertStaffCanAccessClass } from "./students";
import { logAudit } from "./lib/audit";
import { notifyAllActiveStudents, notifyClass } from "./lib/notify";
import { announcementScope, type AnnouncementScope } from "./lib/validators";

/**
 * M5 — announcements. School-wide ones are admin-only; class-scoped ones are
 * writable by an admin or a teacher assigned to that class. `authorName` is
 * denormalized at write so reads never re-join the auth table. Creating an
 * announcement fans out one notification per recipient student. Domain
 * errors use `ConvexError` codes the RTL UI maps to Arabic messages:
 *   invalid_announcement · not_found · not_owner
 */

const MAX_TITLE_LENGTH = 120;
const MAX_BODY_LENGTH = 2000;
const NOTIFICATION_PREVIEW = 100;

/** Row shape shared by the student-facing surfaces (portal home reuses it). */
export const studentAnnouncementValidator = v.object({
  _id: v.id("announcements"),
  scope: announcementScope,
  className: v.optional(v.string()),
  title: v.string(),
  body: v.string(),
  authorName: v.string(),
  _creationTime: v.number(),
});

type StudentAnnouncementRow = {
  _id: Id<"announcements">;
  scope: AnnouncementScope;
  className?: string;
  title: string;
  body: string;
  authorName: string;
  _creationTime: number;
};

/** Cached class-name lookup for the bounded join loops below. */
async function cachedClassName(
  ctx: QueryCtx,
  classId: Id<"classes">,
  cache: Map<Id<"classes">, string>,
): Promise<string> {
  const cached = cache.get(classId);
  if (cached !== undefined) return cached;
  const cls = await ctx.db.get("classes", classId);
  const name = cls?.name ?? "";
  cache.set(classId, name);
  return name;
}

/**
 * The announcements a student sees: school-wide ones plus those of their
 * active classes, merged newest-first and capped. Shared between
 * `listForStudent` (limit 50) and portal.home (limit 3); the CALLER is
 * responsible for having resolved `studentId` from a valid session.
 */
export async function announcementsForStudent(
  ctx: QueryCtx,
  studentId: Id<"students">,
  limit: number,
): Promise<Array<StudentAnnouncementRow>> {
  const enrollments = await ctx.db
    .query("enrollments")
    .withIndex("by_studentId_and_active", (q) =>
      q.eq("studentId", studentId).eq("active", true),
    )
    .take(20);
  const classIds = [
    ...new Set(enrollments.map((enrollment) => enrollment.classId)),
  ];

  const merged: Array<Doc<"announcements">> = await ctx.db
    .query("announcements")
    .withIndex("by_scope", (q) => q.eq("scope", "school"))
    .order("desc")
    .take(50);
  for (const classId of classIds) {
    const rows = await ctx.db
      .query("announcements")
      .withIndex("by_classId", (q) => q.eq("classId", classId))
      .order("desc")
      .take(50);
    merged.push(...rows);
  }
  merged.sort((a, b) => b._creationTime - a._creationTime);

  const classNames = new Map<Id<"classes">, string>();
  const result: Array<StudentAnnouncementRow> = [];
  for (const announcement of merged.slice(0, limit)) {
    result.push({
      _id: announcement._id,
      scope: announcement.scope,
      className:
        announcement.classId !== undefined
          ? await cachedClassName(ctx, announcement.classId, classNames)
          : undefined,
      title: announcement.title,
      body: announcement.body,
      authorName: announcement.authorName,
      _creationTime: announcement._creationTime,
    });
  }
  return result;
}

// ——— Queries ———

/**
 * Staff board: every school-wide announcement plus the class-scoped ones the
 * caller may see (admin: all classes; teacher: assigned classes only),
 * merged newest-first, capped at 100.
 */
export const listBoard = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("announcements"),
      scope: announcementScope,
      className: v.optional(v.string()),
      title: v.string(),
      body: v.string(),
      authorName: v.string(),
      mine: v.boolean(),
      _creationTime: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const staff = await requireTeacher(ctx);

    const merged: Array<Doc<"announcements">> = await ctx.db
      .query("announcements")
      .withIndex("by_scope", (q) => q.eq("scope", "school"))
      .order("desc")
      .take(50);
    if (staff.role === "admin") {
      const classScoped = await ctx.db
        .query("announcements")
        .withIndex("by_scope", (q) => q.eq("scope", "class"))
        .order("desc")
        .take(100);
      merged.push(...classScoped);
    } else {
      const assignments = await ctx.db
        .query("teacherAssignments")
        .withIndex("by_teacherId", (q) => q.eq("teacherId", staff.id))
        .take(200);
      const classIds = [
        ...new Set(assignments.map((assignment) => assignment.classId)),
      ].slice(0, 20);
      for (const classId of classIds) {
        const rows = await ctx.db
          .query("announcements")
          .withIndex("by_classId", (q) => q.eq("classId", classId))
          .order("desc")
          .take(50);
        merged.push(...rows);
      }
    }
    merged.sort((a, b) => b._creationTime - a._creationTime);

    const classNames = new Map<Id<"classes">, string>();
    const result = [];
    for (const announcement of merged.slice(0, 100)) {
      result.push({
        _id: announcement._id,
        scope: announcement.scope,
        className:
          announcement.classId !== undefined
            ? await cachedClassName(ctx, announcement.classId, classNames)
            : undefined,
        title: announcement.title,
        body: announcement.body,
        authorName: announcement.authorName,
        mine: announcement.authorId === staff.id,
        _creationTime: announcement._creationTime,
      });
    }
    return result;
  },
});

/** Student portal: newest 50 announcements visible to this student. */
export const listForStudent = query({
  args: { sessionToken: v.string() },
  returns: v.array(studentAnnouncementValidator),
  handler: async (ctx, args) => {
    const { studentId } = await requireStudentAccount(ctx, args.sessionToken);
    return await announcementsForStudent(ctx, studentId, 50);
  },
});

// ——— Mutations ———

/**
 * Publish an announcement. School scope: admin only; class scope: admin or
 * a teacher assigned to that class. Fans out notifications to the audience.
 */
export const create = mutation({
  args: {
    scope: announcementScope,
    classId: v.optional(v.id("classes")),
    title: v.string(),
    body: v.string(),
  },
  returns: v.id("announcements"),
  handler: async (ctx, args) => {
    const staff =
      args.scope === "school"
        ? await requireAdmin(ctx)
        : await requireTeacher(ctx);

    let classId: Id<"classes"> | undefined;
    if (args.scope === "class") {
      if (args.classId === undefined) {
        throw new ConvexError("invalid_announcement");
      }
      const cls = await ctx.db.get("classes", args.classId);
      if (!cls) throw new ConvexError("invalid_announcement");
      await assertStaffCanAccessClass(ctx, staff, args.classId);
      classId = args.classId;
    }

    const title = args.title.trim();
    const body = args.body.trim();
    if (
      title.length === 0 ||
      title.length > MAX_TITLE_LENGTH ||
      body.length === 0 ||
      body.length > MAX_BODY_LENGTH
    ) {
      throw new ConvexError("invalid_announcement");
    }

    const announcementId = await ctx.db.insert("announcements", {
      scope: args.scope,
      classId,
      title,
      body,
      authorId: staff.id,
      authorName: staff.name,
    });
    await logAudit(ctx, {
      actorType: "staff",
      actorId: staff.id,
      action: "announcement.create",
      targetType: "announcement",
      targetId: announcementId,
      meta:
        classId !== undefined
          ? { scope: args.scope, classId }
          : { scope: args.scope },
    });

    const payload = {
      type: "announcement" as const,
      title,
      body: body.slice(0, NOTIFICATION_PREVIEW),
      refType: "announcement",
    };
    if (args.scope === "school") {
      await notifyAllActiveStudents(ctx, payload);
    } else if (classId !== undefined) {
      await notifyClass(ctx, classId, payload);
    }
    return announcementId;
  },
});

/** Delete an announcement — its author or an admin only. */
export const remove = mutation({
  args: { announcementId: v.id("announcements") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await requireTeacher(ctx);
    const announcement = await ctx.db.get(
      "announcements",
      args.announcementId,
    );
    if (!announcement) throw new ConvexError("not_found");
    if (staff.role !== "admin" && announcement.authorId !== staff.id) {
      throw new ConvexError("not_owner");
    }
    await ctx.db.delete("announcements", args.announcementId);
    await logAudit(ctx, {
      actorType: "staff",
      actorId: staff.id,
      action: "announcement.delete",
      targetType: "announcement",
      targetId: args.announcementId,
      meta: { title: announcement.title, scope: announcement.scope },
    });
    return null;
  },
});
