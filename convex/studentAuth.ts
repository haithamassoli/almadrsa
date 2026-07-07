import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  query,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { logAudit } from "./lib/audit";
import { sha256Hex } from "./lib/crypto";

/**
 * Student/parent session core. Sessions are bearer tokens: the client holds
 * the plaintext token, the DB only ever stores its SHA-256. All PBKDF2 and
 * sha256 of client-supplied secrets happens in the HTTP actions (convex/
 * http.ts); the mutations below receive hashes only.
 */

const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

// ——— Session resolution (shared) ———

type ResolvedSession = {
  session: Doc<"studentSessions">;
  accessCode: Doc<"accessCodes">;
  student: Doc<"students">;
};

/**
 * A session is valid iff: token hash matches, not expired, its access code is
 * still "active", and the student exists and is not archived. Revoking or
 * regenerating a code deletes its sessions, but the status check also covers
 * any race between revocation and an in-flight request.
 */
async function resolveSessionByHash(
  ctx: QueryCtx,
  tokenHash: string,
): Promise<ResolvedSession | null> {
  const session = await ctx.db
    .query("studentSessions")
    .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
    .first();
  if (!session) return null;
  if (session.expiresAt <= Date.now()) return null;
  const accessCode = await ctx.db.get("accessCodes", session.accessCodeId);
  if (!accessCode || accessCode.status !== "active") return null;
  const student = await ctx.db.get("students", session.studentId);
  if (!student || student.status !== "active") return null;
  return { session, accessCode, student };
}

/**
 * Authorization guard for ALL student-portal queries/mutations. Hashes the
 * bearer token, resolves the session and throws Error("Not authenticated")
 * on any invalid/expired/revoked state.
 *
 * Usage in a portal query:
 *   const { studentId } = await requireStudentAccount(ctx, args.sessionToken);
 */
export async function requireStudentAccount(
  ctx: QueryCtx,
  sessionToken: string,
): Promise<{ studentId: Id<"students">; accessCodeId: Id<"accessCodes"> }> {
  const tokenHash = await sha256Hex(sessionToken);
  const resolved = await resolveSessionByHash(ctx, tokenHash);
  if (!resolved) throw new Error("Not authenticated");
  return {
    studentId: resolved.session.studentId,
    accessCodeId: resolved.session.accessCodeId,
  };
}

/** Safe identity probe for the student portal shell. Never throws. */
export const me = query({
  args: { sessionToken: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      student: v.object({
        _id: v.id("students"),
        firstName: v.string(),
        lastName: v.string(),
      }),
    }),
  ),
  handler: async (ctx, args) => {
    const tokenHash = await sha256Hex(args.sessionToken);
    const resolved = await resolveSessionByHash(ctx, tokenHash);
    if (!resolved) return null;
    return {
      student: {
        _id: resolved.student._id,
        firstName: resolved.student.firstName,
        lastName: resolved.student.lastName,
      },
    };
  },
});

// ——— Internal functions for the HTTP actions in convex/http.ts ———

/**
 * Login step 1 (read-only): resolve a code hash to its login context.
 * Returns null for unknown/revoked codes and archived students. `pinHash`/
 * `pinSalt` stay server-side — the HTTP action verifies the PIN and never
 * echoes them to the client.
 */
export const getLoginContext = internalQuery({
  args: {
    codeHash: v.string(),
    deviceTokenHash: v.optional(v.string()),
  },
  returns: v.union(
    v.null(),
    v.object({
      accessCodeId: v.id("accessCodes"),
      studentId: v.id("students"),
      hasPin: v.boolean(),
      pinHash: v.optional(v.string()),
      pinSalt: v.optional(v.string()),
      deviceRemembered: v.boolean(),
      rememberedDeviceId: v.optional(v.id("rememberedDevices")),
      student: v.object({ firstName: v.string(), lastName: v.string() }),
    }),
  ),
  handler: async (ctx, args) => {
    const accessCode = await ctx.db
      .query("accessCodes")
      .withIndex("by_codeHash", (q) => q.eq("codeHash", args.codeHash))
      .first();
    if (!accessCode || accessCode.status !== "active") return null;
    const student = await ctx.db.get("students", accessCode.studentId);
    if (!student || student.status !== "active") return null;

    let deviceRemembered = false;
    let rememberedDeviceId: Id<"rememberedDevices"> | undefined;
    const deviceTokenHash = args.deviceTokenHash;
    if (deviceTokenHash !== undefined) {
      const device = await ctx.db
        .query("rememberedDevices")
        .withIndex("by_deviceTokenHash", (q) =>
          q.eq("deviceTokenHash", deviceTokenHash),
        )
        .first();
      if (device && device.accessCodeId === accessCode._id) {
        deviceRemembered = true;
        rememberedDeviceId = device._id;
      }
    }

    return {
      accessCodeId: accessCode._id,
      studentId: accessCode.studentId,
      hasPin: accessCode.pinHash !== undefined,
      pinHash: accessCode.pinHash,
      pinSalt: accessCode.pinSalt,
      deviceRemembered,
      rememberedDeviceId,
      student: { firstName: student.firstName, lastName: student.lastName },
    };
  },
});

/**
 * Login step 2 (transactional commit): create the session (90-day expiry),
 * optionally register a new remembered device / bump an existing one, stamp
 * lastLoginAt and audit "code.login". Re-checks the code is still active —
 * returns false if it was revoked between step 1 and here.
 */
export const completeLogin = internalMutation({
  args: {
    accessCodeId: v.id("accessCodes"),
    sessionTokenHash: v.string(),
    newDeviceTokenHash: v.optional(v.string()),
    rememberedDeviceId: v.optional(v.id("rememberedDevices")),
    ip: v.optional(v.string()),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const accessCode = await ctx.db.get("accessCodes", args.accessCodeId);
    if (!accessCode || accessCode.status !== "active") return false;
    const student = await ctx.db.get("students", accessCode.studentId);
    if (!student || student.status !== "active") return false;

    await ctx.db.insert("studentSessions", {
      accessCodeId: accessCode._id,
      studentId: accessCode.studentId,
      tokenHash: args.sessionTokenHash,
      expiresAt: now + SESSION_TTL_MS,
    });
    if (args.newDeviceTokenHash !== undefined) {
      await ctx.db.insert("rememberedDevices", {
        accessCodeId: accessCode._id,
        deviceTokenHash: args.newDeviceTokenHash,
        lastSeenAt: now,
      });
    }
    if (args.rememberedDeviceId !== undefined) {
      const device = await ctx.db.get(
        "rememberedDevices",
        args.rememberedDeviceId,
      );
      if (device && device.accessCodeId === accessCode._id) {
        await ctx.db.patch("rememberedDevices", device._id, {
          lastSeenAt: now,
        });
      }
    }
    await ctx.db.patch("accessCodes", accessCode._id, { lastLoginAt: now });
    await logAudit(ctx, {
      actorType: "student",
      actorId: accessCode._id,
      action: "code.login",
      targetType: "student",
      targetId: accessCode.studentId,
      ip: args.ip,
    });
    return true;
  },
});

/**
 * Audit a failed login. Never receives plaintext — only the first 12 hex
 * chars of the sha256 of the normalized attempted code.
 */
export const recordLoginFailure = internalMutation({
  args: {
    codeHashPrefix: v.string(),
    reason: v.union(v.literal("code"), v.literal("pin")),
    accessCodeId: v.optional(v.id("accessCodes")),
    ip: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await logAudit(ctx, {
      actorType: "student",
      actorId: args.accessCodeId ?? "unknown",
      action: "code.login_failed",
      ip: args.ip,
      meta: { codeHashPrefix: args.codeHashPrefix, reason: args.reason },
    });
    return null;
  },
});

/**
 * First-time PIN setup: only allowed while the code has no PIN yet
 * (staff regenerate the code to reset a forgotten PIN).
 */
export const setPin = internalMutation({
  args: {
    sessionTokenHash: v.string(),
    pinHash: v.string(),
    pinSalt: v.string(),
  },
  returns: v.union(
    v.literal("ok"),
    v.literal("invalid_session"),
    v.literal("already_set"),
  ),
  handler: async (ctx, args) => {
    const resolved = await resolveSessionByHash(ctx, args.sessionTokenHash);
    if (!resolved) return "invalid_session";
    if (resolved.accessCode.pinHash !== undefined) return "already_set";
    await ctx.db.patch("accessCodes", resolved.accessCode._id, {
      pinHash: args.pinHash,
      pinSalt: args.pinSalt,
    });
    await logAudit(ctx, {
      actorType: "student",
      actorId: resolved.accessCode._id,
      action: "code.pin_set",
      targetType: "student",
      targetId: resolved.accessCode.studentId,
    });
    return "ok";
  },
});

/** Delete the session row(s) for a token hash. Idempotent. */
export const logout = internalMutation({
  args: { sessionTokenHash: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("studentSessions")
      .withIndex("by_tokenHash", (q) =>
        q.eq("tokenHash", args.sessionTokenHash),
      )
      .take(10);
    for (const session of sessions) {
      await ctx.db.delete("studentSessions", session._id);
    }
    return null;
  },
});
