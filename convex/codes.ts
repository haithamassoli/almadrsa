import { v } from "convex/values";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireStaff, requireTeacher, type StaffUser } from "./auth";
import { logAudit } from "./lib/audit";
import { generateAccessCode, normalizeCode, sha256Hex } from "./lib/crypto";

/**
 * Staff-side access-code management. Plaintext codes exist for exactly one
 * moment: the return value of `issueCode`. Everything else stores/compares
 * SHA-256 of the normalized code only.
 */

// ——— Authorization ———

/**
 * Admin, or a teacher with a teacherAssignments row on the class of the
 * student's ACTIVE enrollment. Throws otherwise.
 */
async function requireCodeManager(
  ctx: QueryCtx,
  studentId: Id<"students">,
): Promise<StaffUser> {
  const staff = await requireStaff(ctx);
  if (staff.role === "admin") return staff;

  const enrollments = await ctx.db
    .query("enrollments")
    .withIndex("by_studentId_and_active", (q) =>
      q.eq("studentId", studentId).eq("active", true),
    )
    .take(20);
  if (enrollments.length === 0) {
    throw new Error("Unauthorized: student has no active enrollment");
  }
  const assignments = await ctx.db
    .query("teacherAssignments")
    .withIndex("by_teacherId", (q) => q.eq("teacherId", staff.id))
    .take(200);
  const enrolledClassIds = new Set<Id<"classes">>(
    enrollments.map((e) => e.classId),
  );
  if (!assignments.some((a) => enrolledClassIds.has(a.classId))) {
    throw new Error("Unauthorized: not assigned to this student's class");
  }
  return staff;
}

// ——— Revocation internals ———

/** Delete every session and remembered device belonging to a code. */
async function purgeCodeAccess(
  ctx: MutationCtx,
  accessCodeId: Id<"accessCodes">,
): Promise<void> {
  // Per-code sets are small; batch anyway to keep reads/writes bounded.
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

/** Revoke all active codes of a student. Returns the revoked code ids. */
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

/**
 * Core issue path, shared by `issueCode` (staff) and the dev-only seed
 * helper. Revokes any existing active code (killing its sessions and
 * remembered devices), inserts the new hash-only row and audits
 * "code.regenerate". Returns the plaintext — the caller must show it once
 * and never persist it.
 */
export async function issueCodeCore(
  ctx: MutationCtx,
  studentId: Id<"students">,
  createdBy: string,
  actor: { actorType: "staff" | "system"; actorId: string },
): Promise<string> {
  const student = await ctx.db.get("students", studentId);
  if (!student) throw new Error("Student not found");

  const revokedCodeIds = await revokeActiveCodes(ctx, studentId);

  const plaintext = generateAccessCode();
  const codeHash = await sha256Hex(normalizeCode(plaintext));
  const accessCodeId = await ctx.db.insert("accessCodes", {
    studentId,
    codeHash,
    status: "active",
    createdBy,
  });

  await logAudit(ctx, {
    actorType: actor.actorType,
    actorId: actor.actorId,
    action: "code.regenerate",
    targetType: "student",
    targetId: studentId,
    meta: { accessCodeId, revokedCodeIds },
  });
  return plaintext;
}

// ——— Public staff API ———

/**
 * Issue (or rotate) the access code for a student. THE ONLY moment the
 * plaintext exists — display it to the staff member, then it is gone.
 */
export const issueCode = mutation({
  args: { studentId: v.id("students") },
  returns: v.object({ code: v.string() }),
  handler: async (ctx, args) => {
    const staff = await requireCodeManager(ctx, args.studentId);
    const code = await issueCodeCore(ctx, args.studentId, staff.id, {
      actorType: "staff",
      actorId: staff.id,
    });
    return { code };
  },
});

/** Revoke a student's active code(s) and kill all their sessions/devices. */
export const revokeCode = mutation({
  args: { studentId: v.id("students") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await requireCodeManager(ctx, args.studentId);
    const revokedCodeIds = await revokeActiveCodes(ctx, args.studentId);
    if (revokedCodeIds.length > 0) {
      await logAudit(ctx, {
        actorType: "staff",
        actorId: staff.id,
        action: "code.revoke",
        targetType: "student",
        targetId: args.studentId,
        meta: { revokedCodeIds },
      });
    }
    return null;
  },
});

/**
 * Admin, or a teacher with a teacherAssignments row on this class. Class-level
 * twin of `requireCodeManager` for bulk operations.
 */
async function requireClassCodeManager(
  ctx: QueryCtx,
  classId: Id<"classes">,
): Promise<StaffUser> {
  const staff = await requireStaff(ctx);
  if (staff.role === "admin") return staff;
  const assignments = await ctx.db
    .query("teacherAssignments")
    .withIndex("by_teacherId", (q) => q.eq("teacherId", staff.id))
    .take(200);
  if (!assignments.some((a) => a.classId === classId)) {
    throw new Error("Unauthorized: not assigned to this class");
  }
  return staff;
}

/**
 * Per-class code roster: every ACTIVE student enrolled in the class with the
 * status of their access code. Staff (teacher or admin) readable.
 */
export const listClassCodeStatus = query({
  args: { classId: v.id("classes") },
  returns: v.array(
    v.object({
      studentId: v.id("students"),
      firstName: v.string(),
      lastName: v.string(),
      hasActiveCode: v.boolean(),
      createdAt: v.optional(v.number()),
      lastLoginAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, args) => {
    await requireTeacher(ctx);
    const enrollments = await ctx.db
      .query("enrollments")
      .withIndex("by_classId_and_active", (q) =>
        q.eq("classId", args.classId).eq("active", true),
      )
      .take(200);
    const rows: Array<{
      studentId: Id<"students">;
      firstName: string;
      lastName: string;
      hasActiveCode: boolean;
      createdAt?: number;
      lastLoginAt?: number;
    }> = [];
    for (const enrollment of enrollments) {
      const student = await ctx.db.get("students", enrollment.studentId);
      if (!student || student.status !== "active") continue;
      const active = await ctx.db
        .query("accessCodes")
        .withIndex("by_studentId_and_status", (q) =>
          q.eq("studentId", student._id).eq("status", "active"),
        )
        .first();
      rows.push({
        studentId: student._id,
        firstName: student.firstName,
        lastName: student.lastName,
        hasActiveCode: active !== null,
        ...(active ? { createdAt: active._creationTime } : {}),
        ...(active?.lastLoginAt !== undefined
          ? { lastLoginAt: active.lastLoginAt }
          : {}),
      });
    }
    rows.sort((a, b) =>
      `${a.firstName} ${a.lastName}`.localeCompare(
        `${b.firstName} ${b.lastName}`,
        "ar",
      ),
    );
    return rows;
  },
});

/**
 * Bulk issue: rotate (or fill in) access codes for every active student
 * enrolled in a class. `onlyMissing` skips students that already hold a live
 * code. Same per-student core as `issueCode` — each issue revokes the old
 * code, kills its sessions and is audited individually. The returned
 * plaintext codes exist ONLY in this return value: display/print once.
 */
export const issueCodesForClass = mutation({
  args: { classId: v.id("classes"), onlyMissing: v.boolean() },
  returns: v.array(
    v.object({
      studentId: v.id("students"),
      firstName: v.string(),
      lastName: v.string(),
      code: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const staff = await requireClassCodeManager(ctx, args.classId);
    const cls = await ctx.db.get("classes", args.classId);
    if (!cls) throw new Error("Class not found");

    const enrollments = await ctx.db
      .query("enrollments")
      .withIndex("by_classId_and_active", (q) =>
        q.eq("classId", args.classId).eq("active", true),
      )
      .take(200);

    const issued: Array<{
      studentId: Id<"students">;
      firstName: string;
      lastName: string;
      code: string;
    }> = [];
    for (const enrollment of enrollments) {
      const student = await ctx.db.get("students", enrollment.studentId);
      if (!student || student.status !== "active") continue;
      if (args.onlyMissing) {
        const active = await ctx.db
          .query("accessCodes")
          .withIndex("by_studentId_and_status", (q) =>
            q.eq("studentId", student._id).eq("status", "active"),
          )
          .first();
        if (active) continue;
      }
      const code = await issueCodeCore(ctx, student._id, staff.id, {
        actorType: "staff",
        actorId: staff.id,
      });
      issued.push({
        studentId: student._id,
        firstName: student.firstName,
        lastName: student.lastName,
        code,
      });
    }
    issued.sort((a, b) =>
      `${a.firstName} ${a.lastName}`.localeCompare(
        `${b.firstName} ${b.lastName}`,
        "ar",
      ),
    );
    return issued;
  },
});

/** Staff-only status card: does the student have a live code, since when. */
export const codeStatus = query({
  args: { studentId: v.id("students") },
  returns: v.object({
    hasActiveCode: v.boolean(),
    createdAt: v.optional(v.number()),
    lastLoginAt: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    await requireStaff(ctx);
    const active = await ctx.db
      .query("accessCodes")
      .withIndex("by_studentId_and_status", (q) =>
        q.eq("studentId", args.studentId).eq("status", "active"),
      )
      .first();
    if (!active) return { hasActiveCode: false };
    return {
      hasActiveCode: true,
      createdAt: active._creationTime,
      lastLoginAt: active.lastLoginAt,
    };
  },
});
