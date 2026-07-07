import { ConvexError, v } from "convex/values";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { components } from "./_generated/api";
import { requireTeacher } from "./auth";
import { assertStaffCanAccessStudent } from "./students";
import { logAudit } from "./lib/audit";
import { notifyStudents } from "./lib/notify";

/**
 * M5 — teacher notes on students. Any staff member with access to the
 * student may read/write (assertStaffCanAccessStudent: admins bypass,
 * teachers need an assignment to one of the student's active classes);
 * deletion is author-or-admin. Creating a note notifies the student.
 * Domain errors use `ConvexError` codes the RTL UI maps to Arabic messages:
 *   invalid_note · not_found · not_owner
 */

const MAX_NOTE_LENGTH = 1000;
const NOTE_NOTIFICATION_PREVIEW = 80;

/**
 * Staff display names by Better Auth user id — one bounded read of the auth
 * component's user table, joined in memory (same pattern as staff.listStaff
 * / academics.listAssignments). Shared with convex/portal.ts.
 */
export async function staffNamesById(
  ctx: QueryCtx | MutationCtx,
): Promise<Map<string, string>> {
  const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: "user",
    paginationOpts: { numItems: 200, cursor: null },
    sortBy: { field: "createdAt", direction: "asc" },
  });
  const page = (result?.page ?? []) as Array<{
    _id: string;
    userId?: string | null;
    name?: string | null;
    email?: string | null;
  }>;
  const names = new Map<string, string>();
  for (const user of page) {
    names.set(user.userId ?? user._id, user.name ?? user.email ?? "");
  }
  return names;
}

// ——— Queries ———

/** A student's notes, newest first, with author names joined. */
export const listByStudent = query({
  args: { studentId: v.id("students") },
  returns: v.array(
    v.object({
      _id: v.id("notes"),
      text: v.string(),
      teacherId: v.string(),
      teacherName: v.string(),
      mine: v.boolean(),
      _creationTime: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const staff = await requireTeacher(ctx);
    await assertStaffCanAccessStudent(ctx, staff, args.studentId);
    const notes = await ctx.db
      .query("notes")
      .withIndex("by_studentId", (q) => q.eq("studentId", args.studentId))
      .order("desc")
      .take(100);
    if (notes.length === 0) return [];

    const names = await staffNamesById(ctx);
    return notes.map((note) => ({
      _id: note._id,
      text: note.text,
      teacherId: note.teacherId,
      teacherName: names.get(note.teacherId) ?? note.teacherId,
      mine: note.teacherId === staff.id,
      _creationTime: note._creationTime,
    }));
  },
});

// ——— Mutations ———

/** Write a note on a student the caller may access; notifies the student. */
export const create = mutation({
  args: { studentId: v.id("students"), text: v.string() },
  returns: v.id("notes"),
  handler: async (ctx, args) => {
    const staff = await requireTeacher(ctx);
    await assertStaffCanAccessStudent(ctx, staff, args.studentId);
    const text = args.text.trim();
    if (text.length === 0 || text.length > MAX_NOTE_LENGTH) {
      throw new ConvexError("invalid_note");
    }

    const noteId = await ctx.db.insert("notes", {
      studentId: args.studentId,
      teacherId: staff.id,
      text,
    });
    await logAudit(ctx, {
      actorType: "staff",
      actorId: staff.id,
      action: "note.create",
      targetType: "student",
      targetId: args.studentId,
      meta: { noteId },
    });
    await notifyStudents(ctx, [args.studentId], {
      type: "note",
      title: "ملاحظة جديدة من المعلّم",
      body: text.slice(0, NOTE_NOTIFICATION_PREVIEW),
      refType: "note",
    });
    return noteId;
  },
});

/** Delete a note — its author or an admin only. */
export const remove = mutation({
  args: { noteId: v.id("notes") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await requireTeacher(ctx);
    const note = await ctx.db.get("notes", args.noteId);
    if (!note) throw new ConvexError("not_found");
    if (staff.role !== "admin" && note.teacherId !== staff.id) {
      throw new ConvexError("not_owner");
    }
    await ctx.db.delete("notes", args.noteId);
    await logAudit(ctx, {
      actorType: "staff",
      actorId: staff.id,
      action: "note.delete",
      targetType: "student",
      targetId: note.studentId,
      meta: { noteId: args.noteId },
    });
    return null;
  },
});
