import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireAdmin, requireTeacher } from "./auth";
import { logAudit } from "./lib/audit";
import { isValidDateKey } from "./lib/dates";

/**
 * M14 — school events & holidays (admin-managed). An event occupies one day
 * (`date`, a "YYYY-MM-DD" key) or an inclusive span through `endDate`;
 * `classId` narrows it to one class, undefined = school-wide. Reads are
 * staff-level; the month queries in convex/calendar.ts merge events into
 * the staff and portal calendars. Writes are admin-only.
 *
 * Domain errors use `ConvexError` codes the RTL UI maps to Arabic messages:
 *   not_found · invalid_event
 */

const MAX_TITLE_LENGTH = 200;

/** Mirrors the schema's inline kind union (see `events` in schema.ts). */
export const eventKind = v.union(v.literal("holiday"), v.literal("event"));

// ——— Shared helpers ———

/**
 * Trim + validate the user-supplied event fields ("invalid_event"): title
 * 1–200 chars; date/endDate real "YYYY-MM-DD" keys with endDate ≥ date.
 * `kind` is already pinned by the args validator.
 */
function normalizeEventInput(input: {
  title: string;
  date: string;
  endDate?: string;
}): { title: string } {
  const title = input.title.trim();
  if (title.length === 0 || title.length > MAX_TITLE_LENGTH) {
    throw new ConvexError("invalid_event");
  }
  if (!isValidDateKey(input.date)) throw new ConvexError("invalid_event");
  if (
    input.endDate !== undefined &&
    (!isValidDateKey(input.endDate) || input.endDate < input.date)
  ) {
    throw new ConvexError("invalid_event");
  }
  return { title };
}

// ——— Queries ———

/**
 * Events whose START day falls in [from, to], chronological, with the class
 * name joined for class-scoped rows. Capped at 200 — far above what one
 * month of school events holds. Malformed range keys read as an empty
 * month rather than an error.
 */
export const list = query({
  args: { from: v.string(), to: v.string() },
  returns: v.array(
    v.object({
      _id: v.id("events"),
      title: v.string(),
      date: v.string(),
      endDate: v.optional(v.string()),
      kind: eventKind,
      classId: v.optional(v.id("classes")),
      className: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    await requireTeacher(ctx);
    if (!isValidDateKey(args.from) || !isValidDateKey(args.to)) return [];
    const events = await ctx.db
      .query("events")
      .withIndex("by_date", (q) =>
        q.gte("date", args.from).lte("date", args.to),
      )
      .take(200);

    const classNames = new Map<Id<"classes">, string>();
    const rows = [];
    for (const event of events) {
      let className: string | undefined;
      if (event.classId !== undefined) {
        className = classNames.get(event.classId);
        if (className === undefined) {
          const cls = await ctx.db.get("classes", event.classId);
          className = cls?.name ?? "";
          classNames.set(event.classId, className);
        }
      }
      rows.push({
        _id: event._id,
        title: event.title,
        date: event.date,
        endDate: event.endDate,
        kind: event.kind,
        classId: event.classId,
        className,
      });
    }
    return rows;
  },
});

// ——— Mutations (admin-only) ———

/** Create an event/holiday; a given classId must name an existing class. */
export const create = mutation({
  args: {
    title: v.string(),
    date: v.string(),
    endDate: v.optional(v.string()),
    kind: eventKind,
    classId: v.optional(v.id("classes")),
  },
  returns: v.id("events"),
  handler: async (ctx, args) => {
    const staff = await requireAdmin(ctx);
    const { title } = normalizeEventInput(args);
    if (args.classId !== undefined) {
      const cls = await ctx.db.get("classes", args.classId);
      if (!cls) throw new ConvexError("not_found");
    }
    const eventId = await ctx.db.insert("events", {
      title,
      date: args.date,
      endDate: args.endDate,
      kind: args.kind,
      classId: args.classId,
    });
    await logAudit(ctx, {
      actorType: "staff",
      actorId: staff.id,
      action: "event.create",
      targetType: "event",
      targetId: eventId,
      meta: {
        date: args.date,
        kind: args.kind,
        ...(args.classId !== undefined ? { classId: args.classId } : {}),
      },
    });
    return eventId;
  },
});

/**
 * Edit an event — a full replacement of the same fields create takes,
 * revalidated identically. An omitted endDate clears back to single-day;
 * an omitted classId widens back to school-wide.
 */
export const update = mutation({
  args: {
    eventId: v.id("events"),
    title: v.string(),
    date: v.string(),
    endDate: v.optional(v.string()),
    kind: eventKind,
    classId: v.optional(v.id("classes")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const event = await ctx.db.get("events", args.eventId);
    if (!event) throw new ConvexError("not_found");
    const { title } = normalizeEventInput(args);
    if (args.classId !== undefined) {
      const cls = await ctx.db.get("classes", args.classId);
      if (!cls) throw new ConvexError("not_found");
    }
    await ctx.db.patch("events", args.eventId, {
      title,
      date: args.date,
      endDate: args.endDate, // undefined clears back to single-day
      kind: args.kind,
      classId: args.classId, // undefined widens back to school-wide
    });
    return null;
  },
});

/** Delete an event. */
export const remove = mutation({
  args: { eventId: v.id("events") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await requireAdmin(ctx);
    const event = await ctx.db.get("events", args.eventId);
    if (!event) throw new ConvexError("not_found");
    await ctx.db.delete("events", args.eventId);
    await logAudit(ctx, {
      actorType: "staff",
      actorId: staff.id,
      action: "event.delete",
      targetType: "event",
      targetId: args.eventId,
      meta: { title: event.title, date: event.date, kind: event.kind },
    });
    return null;
  },
});
