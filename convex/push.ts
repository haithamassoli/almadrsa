import { ConvexError, v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireStudentAccount } from "./studentAuth";

/**
 * M12 — web-push subscription registry (default runtime; delivery lives in
 * convex/pushActions.ts, Node runtime). One row per browser push endpoint,
 * upserted by endpoint: a shared family device re-subscribing under another
 * student reassigns the row, so a device only ever gets one student's pushes.
 * Domain errors: invalid_subscription.
 */

/** Per-student cap: phones + tablets + a couple of browsers is plenty. */
const MAX_SUBSCRIPTIONS_PER_STUDENT = 10;

/** Register (or reassign) this browser's push endpoint for the student. */
export const subscribe = mutation({
  args: {
    sessionToken: v.string(),
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
    userAgent: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { studentId } = await requireStudentAccount(ctx, args.sessionToken);
    if (
      !args.endpoint.startsWith("https://") ||
      args.endpoint.length > 2048 ||
      args.p256dh.length === 0 ||
      args.p256dh.length > 512 ||
      args.auth.length === 0 ||
      args.auth.length > 512
    ) {
      throw new ConvexError("invalid_subscription");
    }
    const userAgent = args.userAgent?.slice(0, 256);

    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint))
      .unique();
    if (existing) {
      await ctx.db.patch("pushSubscriptions", existing._id, {
        studentId,
        p256dh: args.p256dh,
        auth: args.auth,
        userAgent,
      });
      return null;
    }

    // Evict the oldest rows if the student is at the cap (stale browsers).
    const current = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_studentId", (q) => q.eq("studentId", studentId))
      .take(MAX_SUBSCRIPTIONS_PER_STUDENT + 1);
    if (current.length >= MAX_SUBSCRIPTIONS_PER_STUDENT) {
      // Index order is ascending _creationTime — current[0] is the oldest.
      for (const row of current.slice(
        0,
        current.length - (MAX_SUBSCRIPTIONS_PER_STUDENT - 1),
      )) {
        await ctx.db.delete("pushSubscriptions", row._id);
      }
    }

    await ctx.db.insert("pushSubscriptions", {
      studentId,
      endpoint: args.endpoint,
      p256dh: args.p256dh,
      auth: args.auth,
      userAgent,
    });
    return null;
  },
});

/** Drop this browser's endpoint. Idempotent; only the owner's row is freed. */
export const unsubscribe = mutation({
  args: { sessionToken: v.string(), endpoint: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { studentId } = await requireStudentAccount(ctx, args.sessionToken);
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint))
      .unique();
    if (existing && existing.studentId === studentId) {
      await ctx.db.delete("pushSubscriptions", existing._id);
    }
    return null;
  },
});

/** All push subscriptions for a batch of students (delivery action only). */
export const listByStudents = internalQuery({
  args: { studentIds: v.array(v.id("students")) },
  returns: v.array(
    v.object({
      _id: v.id("pushSubscriptions"),
      endpoint: v.string(),
      p256dh: v.string(),
      auth: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const rows: Array<{
      _id: Id<"pushSubscriptions">;
      endpoint: string;
      p256dh: string;
      auth: string;
    }> = [];
    // The delivery action batches callers to ≤100 ids; slice defensively.
    for (const studentId of args.studentIds.slice(0, 100)) {
      const subscriptions = await ctx.db
        .query("pushSubscriptions")
        .withIndex("by_studentId", (q) => q.eq("studentId", studentId))
        .take(MAX_SUBSCRIPTIONS_PER_STUDENT);
      for (const subscription of subscriptions) {
        rows.push({
          _id: subscription._id,
          endpoint: subscription.endpoint,
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        });
      }
    }
    return rows;
  },
});

/** Remove a dead endpoint (push service answered 404/410). Idempotent. */
export const removeById = internalMutation({
  args: { subscriptionId: v.id("pushSubscriptions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db.get("pushSubscriptions", args.subscriptionId);
    if (existing) {
      await ctx.db.delete("pushSubscriptions", args.subscriptionId);
    }
    return null;
  },
});
