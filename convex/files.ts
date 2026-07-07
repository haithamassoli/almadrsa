import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { requireTeacher } from "./auth";

/**
 * M8 — staff-only upload URL minting for exam media. The client POSTs the
 * file to the returned URL and gets back a storage id it then passes to
 * questions.create/update (imageId) or exams.gradeEssay (feedbackAudioId).
 * The student/parent portal never uploads — both mints are teacher-gated.
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
