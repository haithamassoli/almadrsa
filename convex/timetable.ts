import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAdmin, requireTeacher } from "./auth";
import { logAudit } from "./lib/audit";

/**
 * M3 — weekly timetable grid. At most one slot per (class, weekday, period);
 * the school week is Sunday–Thursday (weekday 0–4). Reads are staff-level;
 * writes are admin-only. Domain errors use `ConvexError` codes the RTL UI
 * maps to Arabic messages:
 *   invalid_slot · subject_grade_mismatch · teacher_busy · not_found
 */

export const listForClass = query({
  args: { classId: v.id("classes") },
  returns: v.array(
    v.object({
      _id: v.id("timetableSlots"),
      weekday: v.number(),
      period: v.number(),
      subjectId: v.id("subjects"),
      teacherId: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireTeacher(ctx);
    // Prefix scan on classId only (a class has ≤ ~40 slots).
    const slots = await ctx.db
      .query("timetableSlots")
      .withIndex("by_classId_and_weekday", (q) =>
        q.eq("classId", args.classId),
      )
      .take(100);
    return slots.map((slot) => ({
      _id: slot._id,
      weekday: slot.weekday,
      period: slot.period,
      subjectId: slot.subjectId,
      teacherId: slot.teacherId,
    }));
  },
});

export const upsertSlot = mutation({
  args: {
    classId: v.id("classes"),
    weekday: v.number(),
    period: v.number(),
    subjectId: v.id("subjects"),
    teacherId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    if (
      !Number.isInteger(args.weekday) ||
      args.weekday < 0 ||
      args.weekday > 6 ||
      !Number.isInteger(args.period) ||
      args.period < 1 ||
      args.period > 10
    ) {
      throw new ConvexError("invalid_slot");
    }

    // The slot's subject must belong to the class's grade.
    const subject = await ctx.db.get("subjects", args.subjectId);
    const cls = await ctx.db.get("classes", args.classId);
    if (!subject || !cls || subject.gradeId !== cls.gradeId) {
      throw new ConvexError("subject_grade_mismatch");
    }

    // A teacher cannot be in two classes during the same (weekday, period).
    const teacherSlots = await ctx.db
      .query("timetableSlots")
      .withIndex("by_teacherId_and_weekday", (q) =>
        q.eq("teacherId", args.teacherId).eq("weekday", args.weekday),
      )
      .take(100);
    if (
      teacherSlots.some(
        (slot) => slot.period === args.period && slot.classId !== args.classId,
      )
    ) {
      throw new ConvexError("teacher_busy");
    }

    // Upsert keyed on (classId, weekday, period).
    const daySlots = await ctx.db
      .query("timetableSlots")
      .withIndex("by_classId_and_weekday", (q) =>
        q.eq("classId", args.classId).eq("weekday", args.weekday),
      )
      .take(50);
    const existing = daySlots.find((slot) => slot.period === args.period);
    if (existing) {
      await ctx.db.patch("timetableSlots", existing._id, {
        subjectId: args.subjectId,
        teacherId: args.teacherId,
      });
    } else {
      await ctx.db.insert("timetableSlots", {
        classId: args.classId,
        weekday: args.weekday,
        period: args.period,
        subjectId: args.subjectId,
        teacherId: args.teacherId,
      });
    }

    await logAudit(ctx, {
      actorType: "staff",
      actorId: admin.id,
      action: "timetable.upsert",
      targetType: "class",
      targetId: args.classId,
      meta: {
        weekday: args.weekday,
        period: args.period,
        subjectId: args.subjectId,
        teacherId: args.teacherId,
      },
    });
    return null;
  },
});

export const deleteSlot = mutation({
  args: { slotId: v.id("timetableSlots") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const slot = await ctx.db.get("timetableSlots", args.slotId);
    if (!slot) throw new ConvexError("not_found");
    await ctx.db.delete("timetableSlots", args.slotId);
    await logAudit(ctx, {
      actorType: "staff",
      actorId: admin.id,
      action: "timetable.delete",
      targetType: "class",
      targetId: slot.classId,
      meta: {
        weekday: slot.weekday,
        period: slot.period,
        subjectId: slot.subjectId,
        teacherId: slot.teacherId,
      },
    });
    return null;
  },
});
