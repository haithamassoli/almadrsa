import { ConvexError, v } from "convex/values";
import {
  mutation,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireTeacher } from "./auth";
import { markOneAttendance } from "./attendance";
import { getOwnedLesson } from "./lessons";
import { logAudit } from "./lib/audit";
import { randomSaltHex, sha256Hex, timingSafeEqual } from "./lib/crypto";
import { requireStudentAccount } from "./studentAuth";

/**
 * M11 — QR self check-in. The teacher projects a QR encoding a short-lived
 * signed token for one lesson; a student scanning it marks THEMSELVES
 * "present" (the identity comes from their own session, never the token).
 *
 * The token is STATELESS: `{ l: lessonId, e: expiryMs, s: sha256(l|e|secret) }`
 * with a server-only random secret in the settings table — nothing is stored
 * per token, so nothing needs cleanup and re-scans are naturally idempotent.
 * Tradeoff, stated plainly: a student could forward the QR/link to an absent
 * classmate, so this is DETERRENCE, not prevention — the 2h expiry, the
 * enrollment check, the audit trail and the teacher's ability to correct the
 * sheet bound the damage. That is the same trust level as the shared access
 * code the whole student portal already rests on.
 *
 * Domain errors use `ConvexError` codes the RTL UI maps to Arabic messages:
 *   not_found · invalid_token · token_expired · not_enrolled
 */

const QR_SECRET_KEY = "qrSecret";
const TOKEN_TTL_MS = 2 * 60 * 60 * 1000; // 2h — outlives any single period
const MAX_PAYLOAD_LENGTH = 512; // sane wire cap; real payloads are ~150 chars

type QrPayload = { l: string; e: number; s: string };

/** The exact byte string the signature commits to. */
function signedMaterial(
  lessonId: string,
  expiresAt: number,
  secret: string,
): string {
  return `${lessonId}|${expiresAt}|${secret}`;
}

/** The stored signing secret, or null before the first issueToken. */
async function readSecret(ctx: QueryCtx): Promise<string | null> {
  const row = await ctx.db
    .query("settings")
    .withIndex("by_key", (q) => q.eq("key", QR_SECRET_KEY))
    .unique();
  return typeof row?.value === "string" && row.value.length > 0
    ? row.value
    : null;
}

/** Strict shape parse of a scanned payload; anything off → null. */
function parsePayload(raw: string): QrPayload | null {
  if (raw.length > MAX_PAYLOAD_LENGTH) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const candidate = parsed as Record<string, unknown>;
  if (
    typeof candidate.l !== "string" ||
    typeof candidate.e !== "number" ||
    !Number.isFinite(candidate.e) ||
    typeof candidate.s !== "string"
  ) {
    return null;
  }
  return { l: candidate.l, e: candidate.e, s: candidate.s };
}

/**
 * Mint the signed payload for a lesson — the token core of issueToken,
 * shared with seed.devQrToken so dev smoke tests can exercise checkIn
 * without a staff session (same pattern as codes.issueCodeCore). Creates
 * the signing secret on first use — a mutation, so a concurrent
 * double-create collapses under OCC and the row stays unique.
 * Authorization stays with the callers.
 */
export async function mintQrToken(
  ctx: MutationCtx,
  lessonId: Id<"lessons">,
): Promise<string> {
  let secret = await readSecret(ctx);
  if (secret === null) {
    secret = randomSaltHex() + randomSaltHex(); // 32 random bytes, hex
    await ctx.db.insert("settings", { key: QR_SECRET_KEY, value: secret });
  }
  // Expiry is a flat now+2h (deliberately simpler than "end of the lesson's
  // day": tokens are minted when the teacher opens the screen, so a short
  // fixed TTL already keeps day-old screenshots useless).
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const signature = await sha256Hex(
    signedMaterial(lessonId, expiresAt, secret),
  );
  const payload: QrPayload = { l: lessonId, e: expiresAt, s: signature };
  return JSON.stringify(payload);
}

/**
 * Mint the QR token for a lesson (owner-or-admin, "not_found" otherwise).
 * Returns the JSON payload string the UI renders as a QR / share link.
 */
export const issueToken = mutation({
  args: { lessonId: v.id("lessons") },
  returns: v.string(),
  handler: async (ctx, args) => {
    const staff = await requireTeacher(ctx);
    const lesson = await getOwnedLesson(ctx, staff, args.lessonId);
    return await mintQrToken(ctx, lesson._id);
  },
});

/**
 * Redeem a scanned token: verify the signature and expiry, require an active
 * enrollment in the lesson's class, then mark the caller "present" through
 * the same single-row write path bulkMark uses (markedBy "qr"; the M6 award
 * fires inside on the transition). NEVER downgrades: an existing present/
 * late row is left untouched (idempotent re-scan → alreadyMarked); an
 * "absent" row flips to present — the student is demonstrably here, and the
 * teacher can still correct the sheet.
 */
export const checkIn = mutation({
  args: { sessionToken: v.string(), payload: v.string() },
  returns: v.object({
    lessonTitle: v.string(), // "{subject} — {class}" for the success screen
    alreadyMarked: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const { studentId, accessCodeId } = await requireStudentAccount(
      ctx,
      args.sessionToken,
    );

    const payload = parsePayload(args.payload);
    if (!payload) throw new ConvexError("invalid_token");
    // Signature first (a tampered payload is "invalid", not "expired"); no
    // secret stored means no token was ever legitimately issued.
    const secret = await readSecret(ctx);
    if (secret === null) throw new ConvexError("invalid_token");
    const expected = await sha256Hex(
      signedMaterial(payload.l, payload.e, secret),
    );
    if (!timingSafeEqual(payload.s, expected)) {
      throw new ConvexError("invalid_token");
    }
    if (Date.now() > payload.e) throw new ConvexError("token_expired");

    // The signature guarantees `l` came from issueToken; normalize before
    // trusting the client string as an id anyway.
    const lessonId = ctx.db.normalizeId("lessons", payload.l);
    const lesson =
      lessonId !== null ? await ctx.db.get("lessons", lessonId) : null;
    if (!lesson) throw new ConvexError("not_enrolled");

    const enrollments = await ctx.db
      .query("enrollments")
      .withIndex("by_studentId_and_active", (q) =>
        q.eq("studentId", studentId).eq("active", true),
      )
      .take(20);
    if (!enrollments.some((e) => e.classId === lesson.classId)) {
      throw new ConvexError("not_enrolled");
    }

    const existing = await ctx.db
      .query("attendance")
      .withIndex("by_lessonId_and_studentId", (q) =>
        q.eq("lessonId", lesson._id).eq("studentId", studentId),
      )
      .unique();
    const alreadyMarked =
      existing !== null &&
      (existing.status === "present" || existing.status === "late");
    if (!alreadyMarked) {
      await markOneAttendance(ctx, {
        lesson,
        studentId,
        status: "present",
        markedBy: "qr", // sentinel actor — not a staff id
      });
    }

    await logAudit(ctx, {
      actorType: "student",
      actorId: accessCodeId,
      action: "attendance.qr_checkin",
      targetType: "lesson",
      targetId: lesson._id,
      meta: { alreadyMarked },
    });

    const subject = await ctx.db.get("subjects", lesson.subjectId);
    const cls = await ctx.db.get("classes", lesson.classId);
    return {
      lessonTitle: `${subject?.name ?? ""} — ${cls?.name ?? ""}`,
      alreadyMarked,
    };
  },
});
