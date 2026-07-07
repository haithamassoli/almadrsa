import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { requireTeacher } from "./auth";
import { requireStudentAccount } from "./studentAuth";

/**
 * M8/M9 — upload URL minting. The client POSTs the file to the returned URL
 * and gets back a storage id it then passes to questions.create/update
 * (imageId), exams.gradeEssay (feedbackAudioId) or homework.submit
 * (fileIds/audioId). Staff mints are teacher-gated; the M9 student mint is
 * session-gated.
 */

/** Upload URL for a question illustration image (any question type). */
export const generateQuestionImageUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await requireTeacher(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

/** Upload URL for a per-essay feedback voice note. */
export const generateFeedbackAudioUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await requireTeacher(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * M9 — upload URL for a homework submission attachment (image/PDF/voice
 * note), minted for any logged-in student. Students can only ATTACH files
 * that pass the size/type validation in homework.submit — a minted upload
 * that never gets attached is an orphaned blob, which is acceptable dev
 * debt for now (no cleanup job yet).
 */
export const generateSubmissionUploadUrl = mutation({
  args: { sessionToken: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    await requireStudentAccount(ctx, args.sessionToken);
    return await ctx.storage.generateUploadUrl();
  },
});
