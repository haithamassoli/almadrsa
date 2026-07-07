import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireStudentAccount } from "./studentAuth";
import { notificationType } from "./lib/validators";

/**
 * M5 — student notification center. Every function takes the bearer
 * `sessionToken` and resolves it via requireStudentAccount; a notification
 * is only ever readable/writable by its own student. Rows are written by
 * the fan-out helpers in convex/lib/notify.ts. Domain errors use
 * `ConvexError` codes the RTL UI maps to Arabic messages:
 *   not_found
 */

const notificationRow = v.object({
  _id: v.id("notifications"),
  _creationTime: v.number(),
  studentId: v.id("students"),
  type: notificationType,
  title: v.string(),
  body: v.string(),
  read: v.boolean(),
  refType: v.optional(v.string()),
  refId: v.optional(v.string()),
});

/** The student's newest 100 notifications, unread and read alike. */
export const list = query({
  args: { sessionToken: v.string() },
  returns: v.array(notificationRow),
  handler: async (ctx, args) => {
    const { studentId } = await requireStudentAccount(ctx, args.sessionToken);
    return await ctx.db
      .query("notifications")
      .withIndex("by_studentId", (q) => q.eq("studentId", studentId))
      .order("desc")
      .take(100);
  },
});

/**
 * Unread count for the bell badge, capped at 100 — the UI renders the cap
 * as "99+", so an exact number past it is never needed.
 */
export const unreadCount = query({
  args: { sessionToken: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    const { studentId } = await requireStudentAccount(ctx, args.sessionToken);
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_studentId_and_read", (q) =>
        q.eq("studentId", studentId).eq("read", false),
      )
      .take(100);
    return unread.length;
  },
});

/** Mark one of the student's own notifications read. Idempotent. */
export const markRead = mutation({
  args: { sessionToken: v.string(), notificationId: v.id("notifications") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { studentId } = await requireStudentAccount(ctx, args.sessionToken);
    const notification = await ctx.db.get(
      "notifications",
      args.notificationId,
    );
    if (!notification || notification.studentId !== studentId) {
      throw new ConvexError("not_found");
    }
    if (!notification.read) {
      await ctx.db.patch("notifications", args.notificationId, {
        read: true,
      });
    }
    return null;
  },
});

/**
 * Mark up to 200 unread notifications read; returns how many were patched.
 * A return value of exactly 200 means there may be more — the client
 * re-calls until the count drops below the batch size.
 */
export const markAllRead = mutation({
  args: { sessionToken: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    const { studentId } = await requireStudentAccount(ctx, args.sessionToken);
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_studentId_and_read", (q) =>
        q.eq("studentId", studentId).eq("read", false),
      )
      .take(200);
    for (const notification of unread) {
      await ctx.db.patch("notifications", notification._id, { read: true });
    }
    return unread.length;
  },
});
