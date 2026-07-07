import { ConvexError, v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireTeacher, type StaffUser } from "./auth";
import { requireStudentAccount } from "./studentAuth";
import { assertStaffCanAccessStudent } from "./students";
import { notifyStudents } from "./lib/notify";
import { staffNamesById } from "./notes";
import { senderType } from "./lib/validators";

/**
 * M13 — teacher↔parent messaging. One thread per (student, teacher) pair;
 * the student side is the shared student/parent code account.
 *
 * Dual-auth: `thread`, `send` and `markRead` serve BOTH roles from one
 * function — when `sessionToken` is provided the caller is resolved as the
 * thread's student, otherwise as staff (the thread's teacher, or any admin).
 * A single function per operation lets one conversation component be reused
 * verbatim by the staff page and the portal page.
 *
 * Bounds (ponytail: revisit with pagination if a school outgrows them):
 *   - teacher thread list: newest-created 100 threads (≈100 students —
 *     re-sorted by lastMessageAt in memory)
 *   - student thread list: 50 threads (a student has ~10 teachers)
 *   - message history: newest 100 messages of a thread
 *
 * Staff notification center does not exist, so student messages create NO
 * notification rows — staff see unread counters on the messages page instead
 * (noted limitation). Staff messages DO notify the student (type "message").
 *
 * Domain errors (`ConvexError` codes the RTL UI maps to Arabic):
 *   invalid_message · not_found
 */

const MAX_MESSAGE_LENGTH = 2000;
const PREVIEW_LENGTH = 80;
const NOTIFICATION_BODY_PREVIEW = 100;
const TEACHER_THREADS_LIMIT = 100;
const STUDENT_THREADS_LIMIT = 50;
const MESSAGE_HISTORY_LIMIT = 100;

// ——— Shared member guard ———

type ThreadAccess =
  | { thread: Doc<"threads">; role: "staff"; staff: StaffUser }
  | { thread: Doc<"threads">; role: "student"; studentId: Id<"students"> };

/**
 * Resolve the caller as a member of the thread. With a `sessionToken` the
 * caller must be the thread's student; without one they must be staff — the
 * thread's teacher, or an admin (admins may read/answer any thread).
 * Non-members get the same "not_found" as a missing thread so thread ids
 * leak nothing.
 */
async function requireThreadMember(
  ctx: QueryCtx,
  threadId: Id<"threads">,
  sessionToken: string | undefined,
): Promise<ThreadAccess> {
  const thread = await ctx.db.get("threads", threadId);
  if (!thread) throw new ConvexError("not_found");
  if (sessionToken !== undefined) {
    const { studentId } = await requireStudentAccount(ctx, sessionToken);
    if (thread.studentId !== studentId) throw new ConvexError("not_found");
    return { thread, role: "student", studentId };
  }
  const staff = await requireTeacher(ctx);
  if (staff.role !== "admin" && thread.teacherId !== staff.id) {
    throw new ConvexError("not_found");
  }
  return { thread, role: "staff", staff };
}

// ——— Staff-side queries ———

/**
 * The caller's threads, most recently active first, with student names
 * joined. Threads whose student was hard-deleted are skipped.
 */
export const teacherThreads = query({
  args: {},
  returns: v.array(
    v.object({
      threadId: v.id("threads"),
      studentId: v.id("students"),
      studentName: v.string(),
      lastMessageAt: v.number(),
      lastPreview: v.string(),
      unread: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const staff = await requireTeacher(ctx);
    // Newest-created 100 threads, re-sorted by activity in memory (the index
    // orders by _creationTime, not lastMessageAt).
    const threads = await ctx.db
      .query("threads")
      .withIndex("by_teacherId", (q) => q.eq("teacherId", staff.id))
      .order("desc")
      .take(TEACHER_THREADS_LIMIT);
    threads.sort((a, b) => b.lastMessageAt - a.lastMessageAt);

    const rows: Array<{
      threadId: Id<"threads">;
      studentId: Id<"students">;
      studentName: string;
      lastMessageAt: number;
      lastPreview: string;
      unread: number;
    }> = [];
    for (const thread of threads) {
      const student = await ctx.db.get("students", thread.studentId);
      if (!student) continue; // dangling thread of a deleted student
      rows.push({
        threadId: thread._id,
        studentId: thread.studentId,
        studentName: `${student.firstName} ${student.lastName}`,
        lastMessageAt: thread.lastMessageAt,
        lastPreview: thread.lastPreview,
        unread: thread.teacherUnread,
      });
    }
    return rows;
  },
});

/** Sum of unread counters over the caller's threads — the nav badge. */
export const teacherUnreadTotal = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const staff = await requireTeacher(ctx);
    const threads = await ctx.db
      .query("threads")
      .withIndex("by_teacherId", (q) => q.eq("teacherId", staff.id))
      .order("desc")
      .take(TEACHER_THREADS_LIMIT);
    return threads.reduce((sum, thread) => sum + thread.teacherUnread, 0);
  },
});

// ——— Student-side queries ———

/**
 * The student's threads, most recently active first, with teacher names
 * joined (one bounded read of the auth component's user table).
 */
export const studentThreads = query({
  args: { sessionToken: v.string() },
  returns: v.array(
    v.object({
      threadId: v.id("threads"),
      teacherName: v.string(),
      lastMessageAt: v.number(),
      lastPreview: v.string(),
      unread: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const { studentId } = await requireStudentAccount(ctx, args.sessionToken);
    const threads = await ctx.db
      .query("threads")
      .withIndex("by_studentId", (q) => q.eq("studentId", studentId))
      .order("desc")
      .take(STUDENT_THREADS_LIMIT);
    if (threads.length === 0) return [];
    threads.sort((a, b) => b.lastMessageAt - a.lastMessageAt);

    const names = await staffNamesById(ctx);
    return threads.map((thread) => ({
      threadId: thread._id,
      teacherName: names.get(thread.teacherId) ?? "",
      lastMessageAt: thread.lastMessageAt,
      lastPreview: thread.lastPreview,
      unread: thread.studentUnread,
    }));
  },
});

/** Sum of unread counters over the student's threads — the portal badge. */
export const studentUnreadTotal = query({
  args: { sessionToken: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    const { studentId } = await requireStudentAccount(ctx, args.sessionToken);
    const threads = await ctx.db
      .query("threads")
      .withIndex("by_studentId", (q) => q.eq("studentId", studentId))
      .order("desc")
      .take(STUDENT_THREADS_LIMIT);
    return threads.reduce((sum, thread) => sum + thread.studentUnread, 0);
  },
});

// ——— Conversation (dual-auth) ———

/**
 * One conversation: the newest 100 messages in chronological order plus the
 * counterpart's display name. Serves both roles (see module doc) so the
 * staff page and the portal page share one conversation component.
 */
export const thread = query({
  args: {
    threadId: v.id("threads"),
    sessionToken: v.optional(v.string()),
  },
  returns: v.object({
    threadId: v.id("threads"),
    counterpartName: v.string(),
    messages: v.array(
      v.object({
        _id: v.id("messages"),
        senderType: senderType,
        text: v.string(),
        sentAt: v.number(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const access = await requireThreadMember(
      ctx,
      args.threadId,
      args.sessionToken,
    );

    // Newest 100 by creation time, reversed to chronological for rendering.
    // ponytail: paginate the history when a thread outgrows 100 messages.
    const newestFirst = await ctx.db
      .query("messages")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .order("desc")
      .take(MESSAGE_HISTORY_LIMIT);
    const messages = newestFirst.reverse().map((message) => ({
      _id: message._id,
      senderType: message.senderType,
      text: message.text,
      sentAt: message.sentAt,
    }));

    let counterpartName = "";
    if (access.role === "staff") {
      const student = await ctx.db.get("students", access.thread.studentId);
      if (student) {
        counterpartName = `${student.firstName} ${student.lastName}`;
      }
    } else {
      const names = await staffNamesById(ctx);
      counterpartName = names.get(access.thread.teacherId) ?? "";
    }

    return { threadId: args.threadId, counterpartName, messages };
  },
});

// ——— Mutations ———

/**
 * Get-or-create the (student, caller) thread — the staff entry point into a
 * conversation. Teachers need access to the student's active class; admins
 * pass and become the thread's staff side themselves.
 */
export const openThread = mutation({
  args: { studentId: v.id("students") },
  returns: v.id("threads"),
  handler: async (ctx, args) => {
    const staff = await requireTeacher(ctx);
    const student = await ctx.db.get("students", args.studentId);
    if (!student) throw new ConvexError("not_found");
    await assertStaffCanAccessStudent(ctx, staff, args.studentId);

    const existing = await ctx.db
      .query("threads")
      .withIndex("by_studentId_and_teacherId", (q) =>
        q.eq("studentId", args.studentId).eq("teacherId", staff.id),
      )
      .unique();
    if (existing) return existing._id;

    return await ctx.db.insert("threads", {
      studentId: args.studentId,
      teacherId: staff.id,
      lastMessageAt: Date.now(),
      lastPreview: "",
      teacherUnread: 0,
      studentUnread: 0,
    });
  },
});

/**
 * Append a message (dual-auth, see module doc): insert it, bump the thread's
 * activity stamp/preview and the COUNTERPART's unread counter. Staff messages
 * notify the student in-app + web-push; student messages notify nobody
 * (no staff notification center — unread counters only).
 */
export const send = mutation({
  args: {
    threadId: v.id("threads"),
    text: v.string(),
    sessionToken: v.optional(v.string()),
  },
  returns: v.id("messages"),
  handler: async (ctx, args) => {
    const access = await requireThreadMember(
      ctx,
      args.threadId,
      args.sessionToken,
    );
    const text = args.text.trim();
    if (text.length === 0 || text.length > MAX_MESSAGE_LENGTH) {
      throw new ConvexError("invalid_message");
    }

    const now = Date.now();
    const messageId = await ctx.db.insert("messages", {
      threadId: args.threadId,
      senderType: access.role === "staff" ? "staff" : "student",
      text,
      sentAt: now,
    });
    await ctx.db.patch("threads", args.threadId, {
      lastMessageAt: now,
      lastPreview: text.slice(0, PREVIEW_LENGTH),
      ...(access.role === "staff"
        ? { studentUnread: access.thread.studentUnread + 1 }
        : { teacherUnread: access.thread.teacherUnread + 1 }),
    });

    if (access.role === "staff") {
      await notifyStudents(ctx, [access.thread.studentId], {
        type: "message",
        title: `رسالة من ${access.staff.name}`,
        body: text.slice(0, NOTIFICATION_BODY_PREVIEW),
        refType: "message",
        refId: args.threadId,
      });
    }
    return messageId;
  },
});

/** Zero the CALLER's own unread counter (dual-auth). Idempotent. */
export const markRead = mutation({
  args: {
    threadId: v.id("threads"),
    sessionToken: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const access = await requireThreadMember(
      ctx,
      args.threadId,
      args.sessionToken,
    );
    if (access.role === "staff") {
      if (access.thread.teacherUnread !== 0) {
        await ctx.db.patch("threads", args.threadId, { teacherUnread: 0 });
      }
    } else if (access.thread.studentUnread !== 0) {
      await ctx.db.patch("threads", args.threadId, { studentUnread: 0 });
    }
    return null;
  },
});
