import { ConvexError, v } from "convex/values";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAdmin, requireStaff, type StaffUser } from "./auth";
import { issueCodeCore } from "./codes";
import { logAudit } from "./lib/audit";
import { studentStatus } from "./lib/validators";

/**
 * M2 — students, enrollment, CSV-import rows and bulk codes.
 *
 * Reads are staff-level (teachers are scoped to their assigned classes);
 * every write is admin-only per M2 rules.
 *
 * All reads are index-only and bounded (`.take()` / `.first()`); all thrown
 * domain errors use `ConvexError(code)` so the RTL UI can branch on a stable
 * machine code (plain `Error` messages are redacted in production):
 *   not_found · class_not_found · class_required · too_many_rows
 *   invalid_firstName · invalid_lastName · invalid_guardianName · invalid_phone
 */

// ——— Shared row types (align 1:1 with the `returns` validators) ———

type StudentListRow = {
  _id: Id<"students">;
  firstName: string;
  lastName: string;
  guardianName?: string;
  guardianPhone?: string;
  status: Doc<"students">["status"];
  classId?: Id<"classes">;
  className?: string;
};

// ——— Authorization helpers ———

/**
 * Admin passes. Teacher must own a `teacherAssignments` row for `classId`.
 * Cheaper of the two scans: fetch the class's assignments (bounded) and test
 * membership, rather than the teacher's whole assignment list.
 */
async function assertStaffCanAccessClass(
  ctx: QueryCtx,
  staff: StaffUser,
  classId: Id<"classes">,
): Promise<void> {
  if (staff.role === "admin") return;
  const assignments = await ctx.db
    .query("teacherAssignments")
    .withIndex("by_classId", (q) => q.eq("classId", classId))
    .take(50);
  if (!assignments.some((a) => a.teacherId === staff.id)) {
    throw new Error("Unauthorized: not assigned to this class");
  }
}

/**
 * Admin passes. Teacher must be assigned to a class the student is ACTIVELY
 * enrolled in. Throws if the student has no active enrollment (a teacher has
 * no scope over an unenrolled student). Mirrors `requireCodeManager` in
 * convex/codes.ts.
 */
async function assertStaffCanAccessStudent(
  ctx: QueryCtx,
  staff: StaffUser,
  studentId: Id<"students">,
): Promise<void> {
  if (staff.role === "admin") return;
  const enrollments = await ctx.db
    .query("enrollments")
    .withIndex("by_studentId_and_active", (q) =>
      q.eq("studentId", studentId).eq("active", true),
    )
    .take(20);
  if (enrollments.length === 0) {
    throw new Error("Unauthorized: student has no active enrollment");
  }
  const enrolledClassIds = new Set<Id<"classes">>(
    enrollments.map((e) => e.classId),
  );
  const assignments = await ctx.db
    .query("teacherAssignments")
    .withIndex("by_teacherId", (q) => q.eq("teacherId", staff.id))
    .take(200);
  if (!assignments.some((a) => enrolledClassIds.has(a.classId))) {
    throw new Error("Unauthorized: not assigned to this student's class");
  }
}

// ——— Class resolution ———

/**
 * The student's single active class (by convention there is at most one).
 * Optional `classNameCache` collapses repeated class lookups when resolving a
 * whole roster.
 */
async function resolveActiveClass(
  ctx: QueryCtx,
  studentId: Id<"students">,
  classNameCache?: Map<Id<"classes">, string | undefined>,
): Promise<{ classId?: Id<"classes">; className?: string }> {
  const enrollment = await ctx.db
    .query("enrollments")
    .withIndex("by_studentId_and_active", (q) =>
      q.eq("studentId", studentId).eq("active", true),
    )
    .first();
  if (!enrollment) return {};
  const classId = enrollment.classId;
  if (classNameCache && classNameCache.has(classId)) {
    return { classId, className: classNameCache.get(classId) };
  }
  const cls = await ctx.db.get("classes", classId);
  const className = cls?.name;
  if (classNameCache) classNameCache.set(classId, className);
  return { classId, className };
}

/** Deactivate every active enrollment of a student (bounded loop). */
async function deactivateActiveEnrollments(
  ctx: MutationCtx,
  studentId: Id<"students">,
): Promise<Array<Id<"classes">>> {
  const fromClassIds: Array<Id<"classes">> = [];
  for (;;) {
    const active = await ctx.db
      .query("enrollments")
      .withIndex("by_studentId_and_active", (q) =>
        q.eq("studentId", studentId).eq("active", true),
      )
      .take(10);
    for (const enrollment of active) {
      await ctx.db.patch("enrollments", enrollment._id, { active: false });
      fromClassIds.push(enrollment.classId);
    }
    if (active.length < 10) break;
  }
  return fromClassIds;
}

// ——— Input normalization (shared by createStudent + bulkImport) ———

type NormalizedStudentInput = {
  firstName: string;
  lastName: string;
  guardianName?: string;
  guardianPhone?: string;
};

const PHONE_CHARS = /^[0-9+\-\s]+$/;

/**
 * Trim + validate a student input row. Names are required (1..100 chars after
 * trim); guardianName is optional (≤100); guardianPhone is optional (6..20
 * chars of digits / + / - / space). Returns a machine code on the first
 * failure instead of throwing so bulkImport can report it per row.
 */
function normalizeStudentInput(input: {
  firstName: string;
  lastName: string;
  guardianName?: string;
  guardianPhone?: string;
}):
  | { ok: true; value: NormalizedStudentInput }
  | { ok: false; error: string } {
  const firstName = input.firstName.trim();
  if (firstName.length === 0 || firstName.length > 100) {
    return { ok: false, error: "invalid_firstName" };
  }
  const lastName = input.lastName.trim();
  if (lastName.length === 0 || lastName.length > 100) {
    return { ok: false, error: "invalid_lastName" };
  }
  const value: NormalizedStudentInput = { firstName, lastName };

  const guardianName = input.guardianName?.trim();
  if (guardianName !== undefined && guardianName.length > 0) {
    if (guardianName.length > 100) {
      return { ok: false, error: "invalid_guardianName" };
    }
    value.guardianName = guardianName;
  }

  const guardianPhone = input.guardianPhone?.trim();
  if (guardianPhone !== undefined && guardianPhone.length > 0) {
    if (
      guardianPhone.length < 6 ||
      guardianPhone.length > 20 ||
      !PHONE_CHARS.test(guardianPhone)
    ) {
      return { ok: false, error: "invalid_phone" };
    }
    value.guardianPhone = guardianPhone;
  }

  return { ok: true, value };
}

// ——— Code-access purge (replicated minimally from codes.ts, which does not
// export these; convex/students.ts must not edit codes.ts) ———

/** Delete every session and remembered device belonging to a code. */
async function purgeCodeAccess(
  ctx: MutationCtx,
  accessCodeId: Id<"accessCodes">,
): Promise<void> {
  for (;;) {
    const sessions = await ctx.db
      .query("studentSessions")
      .withIndex("by_accessCodeId", (q) => q.eq("accessCodeId", accessCodeId))
      .take(200);
    for (const session of sessions) {
      await ctx.db.delete("studentSessions", session._id);
    }
    if (sessions.length < 200) break;
  }
  for (;;) {
    const devices = await ctx.db
      .query("rememberedDevices")
      .withIndex("by_accessCodeId", (q) => q.eq("accessCodeId", accessCodeId))
      .take(200);
    for (const device of devices) {
      await ctx.db.delete("rememberedDevices", device._id);
    }
    if (devices.length < 200) break;
  }
}

/** Revoke a student's active codes and kill their sessions/devices. */
async function revokeActiveCodes(
  ctx: MutationCtx,
  studentId: Id<"students">,
): Promise<Array<Id<"accessCodes">>> {
  const now = Date.now();
  const activeCodes = await ctx.db
    .query("accessCodes")
    .withIndex("by_studentId_and_status", (q) =>
      q.eq("studentId", studentId).eq("status", "active"),
    )
    .take(20);
  for (const code of activeCodes) {
    await ctx.db.patch("accessCodes", code._id, {
      status: "revoked",
      revokedAt: now,
    });
    await purgeCodeAccess(ctx, code._id);
  }
  return activeCodes.map((c) => c._id);
}

// ——— Queries ———

/**
 * Roster listing, bounded to 200 rows before filtering.
 * - `classId`: students actively enrolled in that class (teacher must be
 *   assigned to it; admins pass). Without `classId` teachers get
 *   "class_required"; admins get a whole-school listing.
 * - `status`: keep only that status. Omitted = all statuses.
 * - `search`: case-insensitive prefix match on firstName / lastName / full
 *   name, applied in-memory over the bounded set (fine at ≤200 rows; a search
 *   index would replace this at real scale).
 */
export const listStudents = query({
  args: {
    classId: v.optional(v.id("classes")),
    status: v.optional(studentStatus),
    search: v.optional(v.string()),
  },
  returns: v.array(
    v.object({
      _id: v.id("students"),
      firstName: v.string(),
      lastName: v.string(),
      guardianName: v.optional(v.string()),
      guardianPhone: v.optional(v.string()),
      status: studentStatus,
      classId: v.optional(v.id("classes")),
      className: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args): Promise<Array<StudentListRow>> => {
    const staff = await requireStaff(ctx);
    const search = args.search?.trim().toLowerCase();
    const matchesSearch = (s: { firstName: string; lastName: string }) => {
      if (!search) return true;
      const first = s.firstName.toLowerCase();
      const last = s.lastName.toLowerCase();
      return (
        first.startsWith(search) ||
        last.startsWith(search) ||
        `${first} ${last}`.startsWith(search)
      );
    };

    // Scoped to one class (via its active enrollments).
    if (args.classId !== undefined) {
      const classId = args.classId;
      await assertStaffCanAccessClass(ctx, staff, classId);
      const cls = await ctx.db.get("classes", classId);
      const className = cls?.name;
      const enrollments = await ctx.db
        .query("enrollments")
        .withIndex("by_classId_and_active", (q) =>
          q.eq("classId", classId).eq("active", true),
        )
        .take(200);
      const rows: Array<StudentListRow> = [];
      for (const enrollment of enrollments) {
        const student = await ctx.db.get("students", enrollment.studentId);
        if (!student) continue;
        if (args.status !== undefined && student.status !== args.status) {
          continue;
        }
        if (!matchesSearch(student)) continue;
        rows.push({
          _id: student._id,
          firstName: student.firstName,
          lastName: student.lastName,
          guardianName: student.guardianName,
          guardianPhone: student.guardianPhone,
          status: student.status,
          classId,
          className,
        });
      }
      return rows;
    }

    // No class specified — admin-only, whole-school listing.
    if (staff.role !== "admin") {
      throw new ConvexError("class_required");
    }
    const status = args.status;
    // When searching we must scan the whole school, not just the newest 200,
    // or matches past the cap silently vanish. A single school is bounded to
    // low thousands of students, so a full scan stays well within query
    // limits. ponytail: full scan up to WHOLE_SCHOOL_SCAN; add a students
    // search index if a tenant ever exceeds that.
    const WHOLE_SCHOOL_SCAN = 5000;
    const limit = search ? WHOLE_SCHOOL_SCAN : 200;
    const students =
      status !== undefined
        ? await ctx.db
            .query("students")
            .withIndex("by_status", (q) => q.eq("status", status))
            .take(limit)
        : await ctx.db.query("students").take(limit);
    const classNameCache = new Map<Id<"classes">, string | undefined>();
    const rows: Array<StudentListRow> = [];
    for (const student of students) {
      if (!matchesSearch(student)) continue;
      const { classId, className } = await resolveActiveClass(
        ctx,
        student._id,
        classNameCache,
      );
      rows.push({
        _id: student._id,
        firstName: student.firstName,
        lastName: student.lastName,
        guardianName: student.guardianName,
        guardianPhone: student.guardianPhone,
        status: student.status,
        classId,
        className,
      });
    }
    return rows;
  },
});

/**
 * Single student detail + active class + live-code status. Teachers need
 * access to the student's active class; admins bypass.
 */
export const getStudent = query({
  args: { studentId: v.id("students") },
  returns: v.object({
    _id: v.id("students"),
    firstName: v.string(),
    lastName: v.string(),
    guardianName: v.optional(v.string()),
    guardianPhone: v.optional(v.string()),
    status: studentStatus,
    classId: v.optional(v.id("classes")),
    className: v.optional(v.string()),
    hasActiveCode: v.boolean(),
    lastLoginAt: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx);
    const student = await ctx.db.get("students", args.studentId);
    if (!student) throw new ConvexError("not_found");
    await assertStaffCanAccessStudent(ctx, staff, args.studentId);

    const { classId, className } = await resolveActiveClass(
      ctx,
      args.studentId,
    );
    const activeCode = await ctx.db
      .query("accessCodes")
      .withIndex("by_studentId_and_status", (q) =>
        q.eq("studentId", args.studentId).eq("status", "active"),
      )
      .first();

    return {
      _id: student._id,
      firstName: student.firstName,
      lastName: student.lastName,
      guardianName: student.guardianName,
      guardianPhone: student.guardianPhone,
      status: student.status,
      classId,
      className,
      hasActiveCode: activeCode !== null,
      lastLoginAt: activeCode?.lastLoginAt,
    };
  },
});

/**
 * Codes-admin roster: every ACTIVE student actively enrolled in the class,
 * with whether they hold a live code and when they last logged in. Same set
 * `bulkIssueCodes` would issue to.
 */
export const classCodesOverview = query({
  args: { classId: v.id("classes") },
  returns: v.array(
    v.object({
      studentId: v.id("students"),
      firstName: v.string(),
      lastName: v.string(),
      hasActiveCode: v.boolean(),
      lastLoginAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx);
    await assertStaffCanAccessClass(ctx, staff, args.classId);

    const enrollments = await ctx.db
      .query("enrollments")
      .withIndex("by_classId_and_active", (q) =>
        q.eq("classId", args.classId).eq("active", true),
      )
      .take(500);

    const rows: Array<{
      studentId: Id<"students">;
      firstName: string;
      lastName: string;
      hasActiveCode: boolean;
      lastLoginAt?: number;
    }> = [];
    for (const enrollment of enrollments) {
      const student = await ctx.db.get("students", enrollment.studentId);
      if (!student || student.status !== "active") continue;
      const activeCode = await ctx.db
        .query("accessCodes")
        .withIndex("by_studentId_and_status", (q) =>
          q.eq("studentId", enrollment.studentId).eq("status", "active"),
        )
        .first();
      rows.push({
        studentId: enrollment.studentId,
        firstName: student.firstName,
        lastName: student.lastName,
        hasActiveCode: activeCode !== null,
        lastLoginAt: activeCode?.lastLoginAt,
      });
    }
    return rows;
  },
});

// ——— Mutations (all admin-only per M2) ———

/**
 * Create a student (status "active"), optionally enrolling into a class.
 */
export const createStudent = mutation({
  args: {
    firstName: v.string(),
    lastName: v.string(),
    guardianName: v.optional(v.string()),
    guardianPhone: v.optional(v.string()),
    classId: v.optional(v.id("classes")),
  },
  returns: v.object({ studentId: v.id("students") }),
  handler: async (ctx, args) => {
    const staff = await requireAdmin(ctx);
    if (args.classId !== undefined) {
      const cls = await ctx.db.get("classes", args.classId);
      if (!cls) throw new ConvexError("class_not_found");
    }

    const normalized = normalizeStudentInput(args);
    if (!normalized.ok) throw new ConvexError(normalized.error);

    const studentId = await ctx.db.insert("students", {
      ...normalized.value,
      status: "active",
    });
    if (args.classId !== undefined) {
      await ctx.db.insert("enrollments", {
        studentId,
        classId: args.classId,
        active: true,
      });
    }

    await logAudit(ctx, {
      actorType: "staff",
      actorId: staff.id,
      action: "student.create",
      targetType: "student",
      targetId: studentId,
      meta: args.classId !== undefined ? { classId: args.classId } : undefined,
    });
    return { studentId };
  },
});

/**
 * Patch a student's name / guardian fields; optionally move them to another
 * class. Only supplied fields change; an empty-string guardian field clears
 * it. When `classId` differs from the current active enrollment, the old
 * enrollment(s) are deactivated and a fresh active one inserted.
 */
export const updateStudent = mutation({
  args: {
    studentId: v.id("students"),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    guardianName: v.optional(v.string()),
    guardianPhone: v.optional(v.string()),
    classId: v.optional(v.id("classes")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await requireAdmin(ctx);
    const student = await ctx.db.get("students", args.studentId);
    if (!student) throw new ConvexError("not_found");

    const patch: {
      firstName?: string;
      lastName?: string;
      guardianName?: string;
      guardianPhone?: string;
    } = {};

    if (args.firstName !== undefined) {
      const trimmed = args.firstName.trim();
      if (trimmed.length === 0 || trimmed.length > 100) {
        throw new ConvexError("invalid_firstName");
      }
      patch.firstName = trimmed;
    }
    if (args.lastName !== undefined) {
      const trimmed = args.lastName.trim();
      if (trimmed.length === 0 || trimmed.length > 100) {
        throw new ConvexError("invalid_lastName");
      }
      patch.lastName = trimmed;
    }
    if (args.guardianName !== undefined) {
      const trimmed = args.guardianName.trim();
      if (trimmed.length === 0) {
        patch.guardianName = undefined; // clear
      } else if (trimmed.length > 100) {
        throw new ConvexError("invalid_guardianName");
      } else {
        patch.guardianName = trimmed;
      }
    }
    if (args.guardianPhone !== undefined) {
      const trimmed = args.guardianPhone.trim();
      if (trimmed.length === 0) {
        patch.guardianPhone = undefined; // clear
      } else if (
        trimmed.length < 6 ||
        trimmed.length > 20 ||
        !PHONE_CHARS.test(trimmed)
      ) {
        throw new ConvexError("invalid_phone");
      } else {
        patch.guardianPhone = trimmed;
      }
    }

    await ctx.db.patch("students", args.studentId, patch);

    // Class change: deactivate old active enrollment(s), insert the new one.
    let movedTo: Id<"classes"> | undefined;
    if (args.classId !== undefined) {
      const targetClass = await ctx.db.get("classes", args.classId);
      if (!targetClass) throw new ConvexError("class_not_found");
      const current = await ctx.db
        .query("enrollments")
        .withIndex("by_studentId_and_active", (q) =>
          q.eq("studentId", args.studentId).eq("active", true),
        )
        .first();
      if (!current || current.classId !== args.classId) {
        await deactivateActiveEnrollments(ctx, args.studentId);
        await ctx.db.insert("enrollments", {
          studentId: args.studentId,
          classId: args.classId,
          active: true,
        });
        movedTo = args.classId;
      }
    }

    await logAudit(ctx, {
      actorType: "staff",
      actorId: staff.id,
      action: "student.update",
      targetType: "student",
      targetId: args.studentId,
      meta: movedTo !== undefined ? { movedToClassId: movedTo } : undefined,
    });
    return null;
  },
});

/**
 * Move a student to another class: deactivate every current active enrollment
 * (bounded loop) and insert a fresh active one.
 */
export const moveStudent = mutation({
  args: { studentId: v.id("students"), classId: v.id("classes") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await requireAdmin(ctx);
    const student = await ctx.db.get("students", args.studentId);
    if (!student) throw new ConvexError("not_found");
    const targetClass = await ctx.db.get("classes", args.classId);
    if (!targetClass) throw new ConvexError("class_not_found");

    const fromClassIds = await deactivateActiveEnrollments(ctx, args.studentId);
    await ctx.db.insert("enrollments", {
      studentId: args.studentId,
      classId: args.classId,
      active: true,
    });

    await logAudit(ctx, {
      actorType: "staff",
      actorId: staff.id,
      action: "student.move",
      targetType: "student",
      targetId: args.studentId,
      meta: { toClassId: args.classId, fromClassIds },
    });
    return null;
  },
});

/**
 * Archive a student: mark status "archived", deactivate their enrollments and
 * revoke active codes (purging sessions / remembered devices).
 */
export const archiveStudent = mutation({
  args: { studentId: v.id("students") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await requireAdmin(ctx);
    const student = await ctx.db.get("students", args.studentId);
    if (!student) throw new ConvexError("not_found");

    await ctx.db.patch("students", args.studentId, { status: "archived" });
    const fromClassIds = await deactivateActiveEnrollments(ctx, args.studentId);
    const revokedCodeIds = await revokeActiveCodes(ctx, args.studentId);

    await logAudit(ctx, {
      actorType: "staff",
      actorId: staff.id,
      action: "student.archive",
      targetType: "student",
      targetId: args.studentId,
      meta: { revokedCodeIds, fromClassIds },
    });
    return null;
  },
});

/**
 * Hard-delete a student and every dependent row: access codes (any status)
 * with their sessions/devices, then enrollments, then the student. All in
 * bounded `.take()` loops.
 *
 * M2 has no attendance/exam tables yet — when they land, this must first
 * check for history rows and refuse (archive instead) if any exist.
 */
export const deleteStudent = mutation({
  args: { studentId: v.id("students") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await requireAdmin(ctx);
    const student = await ctx.db.get("students", args.studentId);
    if (!student) throw new ConvexError("not_found");

    // Access codes (both statuses) + their sessions / devices.
    for (const status of ["active", "revoked"] as const) {
      for (;;) {
        const codes = await ctx.db
          .query("accessCodes")
          .withIndex("by_studentId_and_status", (q) =>
            q.eq("studentId", args.studentId).eq("status", status),
          )
          .take(50);
        for (const code of codes) {
          await purgeCodeAccess(ctx, code._id);
          await ctx.db.delete("accessCodes", code._id);
        }
        if (codes.length < 50) break;
      }
    }

    // Enrollments (active and inactive).
    for (const active of [true, false] as const) {
      for (;;) {
        const enrollments = await ctx.db
          .query("enrollments")
          .withIndex("by_studentId_and_active", (q) =>
            q.eq("studentId", args.studentId).eq("active", active),
          )
          .take(50);
        for (const enrollment of enrollments) {
          await ctx.db.delete("enrollments", enrollment._id);
        }
        if (enrollments.length < 50) break;
      }
    }

    await ctx.db.delete("students", args.studentId);
    await logAudit(ctx, {
      actorType: "staff",
      actorId: staff.id,
      action: "student.delete",
      targetType: "student",
      targetId: args.studentId,
      meta: { firstName: student.firstName, lastName: student.lastName },
    });
    return null;
  },
});

/**
 * Import up to 500 pre-parsed rows (CSV parsing is the UI's job). Each row is
 * validated independently; a row's optional `className` must exactly match an
 * existing class name (name → id map built once). Valid rows create a student
 * (+ active enrollment when a class was named) and stay committed even when
 * other rows fail; failed rows are reported with a 1-based `row` number and a
 * machine error code.
 */
export const bulkImport = mutation({
  args: {
    rows: v.array(
      v.object({
        firstName: v.string(),
        lastName: v.string(),
        guardianName: v.optional(v.string()),
        guardianPhone: v.optional(v.string()),
        className: v.optional(v.string()),
      }),
    ),
  },
  returns: v.object({
    imported: v.number(),
    failed: v.number(),
    results: v.array(
      v.object({
        row: v.number(),
        ok: v.boolean(),
        error: v.optional(v.string()),
        studentId: v.optional(v.id("students")),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const staff = await requireAdmin(ctx);
    if (args.rows.length < 1 || args.rows.length > 500) {
      throw new ConvexError("too_many_rows");
    }

    // Exact-name → id map, built once. Classes are a small bounded set.
    // Section names ("أ"/"ب") legitimately repeat across grades, so a
    // duplicate name is ambiguous, not last-wins — those rows must fail
    // loudly rather than enroll a child in an arbitrary class.
    const classes = await ctx.db.query("classes").take(500);
    const classIdByName = new Map<string, Id<"classes"> | "ambiguous">();
    for (const c of classes) {
      const key = c.name.trim();
      classIdByName.set(key, classIdByName.has(key) ? "ambiguous" : c._id);
    }

    const results: Array<{
      row: number;
      ok: boolean;
      error?: string;
      studentId?: Id<"students">;
    }> = [];
    let imported = 0;
    for (let i = 0; i < args.rows.length; i++) {
      const raw = args.rows[i];
      const row = i + 1; // 1-based data-row number, mirrors the CSV preview
      const normalized = normalizeStudentInput(raw);
      if (!normalized.ok) {
        results.push({ row, ok: false, error: normalized.error });
        continue;
      }
      let classId: Id<"classes"> | undefined;
      const className = raw.className?.trim();
      if (className !== undefined && className.length > 0) {
        const match = classIdByName.get(className);
        if (match === undefined) {
          results.push({ row, ok: false, error: "class_not_found" });
          continue;
        }
        if (match === "ambiguous") {
          results.push({ row, ok: false, error: "class_ambiguous" });
          continue;
        }
        classId = match;
      }
      const studentId = await ctx.db.insert("students", {
        ...normalized.value,
        status: "active",
      });
      if (classId !== undefined) {
        await ctx.db.insert("enrollments", {
          studentId,
          classId,
          active: true,
        });
      }
      imported++;
      results.push({ row, ok: true, studentId });
    }

    const failed = args.rows.length - imported;
    await logAudit(ctx, {
      actorType: "staff",
      actorId: staff.id,
      action: "student.bulk_import",
      targetType: "students",
      meta: { imported, failed },
    });
    return { imported, failed, results };
  },
});

/**
 * Rotate a fresh access code for every ACTIVE student actively enrolled in the
 * class (≤300). Delegates to `issueCodeCore` (revokes any prior code + audits
 * per student). Returns the plaintext codes — the print view's only data
 * source; they are never stored. Admin, or a teacher with access to the class.
 */
export const bulkIssueCodes = mutation({
  args: { classId: v.id("classes") },
  returns: v.object({
    items: v.array(
      v.object({
        studentId: v.id("students"),
        firstName: v.string(),
        lastName: v.string(),
        code: v.string(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx);
    await assertStaffCanAccessClass(ctx, staff, args.classId);

    const enrollments = await ctx.db
      .query("enrollments")
      .withIndex("by_classId_and_active", (q) =>
        q.eq("classId", args.classId).eq("active", true),
      )
      .take(300);

    const items: Array<{
      studentId: Id<"students">;
      firstName: string;
      lastName: string;
      code: string;
    }> = [];
    for (const enrollment of enrollments) {
      const student = await ctx.db.get("students", enrollment.studentId);
      if (!student || student.status !== "active") continue;
      const code = await issueCodeCore(ctx, enrollment.studentId, staff.id, {
        actorType: "staff",
        actorId: staff.id,
      });
      items.push({
        studentId: enrollment.studentId,
        firstName: student.firstName,
        lastName: student.lastName,
        code,
      });
    }
    return { items };
  },
});
