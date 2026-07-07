import { ConvexError, v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
import { requireAdmin } from "./auth";
import { logAudit } from "./lib/audit";
import { readChannelsConfig } from "./lib/channels";

/**
 * M15 — admin settings CRUD for the guardian message channels (settings key
 * "channels"; read/dispatch helpers live in convex/lib/channels.ts, the
 * delivery action in convex/channelActions.ts). Domain errors use
 * `ConvexError` codes the RTL UI maps to Arabic messages:
 *   invalid_config
 */

const SETTINGS_KEY = "channels";
const MAX_WEBHOOK_URL_LENGTH = 2048;

const channelsConfigValidator = v.object({
  webhookEnabled: v.boolean(),
  webhookUrl: v.optional(v.string()),
});

/** Admin: the effective channels config (defaults to disabled). */
export const channelsConfig = query({
  args: {},
  returns: channelsConfigValidator,
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return await readChannelsConfig(ctx);
  },
});

/** The delivery action's config read (convex/channelActions.ts only). */
export const channelsConfigInternal = internalQuery({
  args: {},
  returns: channelsConfigValidator,
  handler: async (ctx) => {
    return await readChannelsConfig(ctx);
  },
});

/**
 * Admin: replace the channels config. Enabling requires an https:// webhook
 * URL (≤2048 chars); a URL may be stored while disabled (toggling off keeps
 * it for later). Audited as "settings.channels" — the URL itself stays out
 * of the audit meta (webhook URLs routinely embed secret tokens).
 */
export const saveChannelsConfig = mutation({
  args: {
    webhookEnabled: v.boolean(),
    webhookUrl: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const staff = await requireAdmin(ctx);
    const trimmed = args.webhookUrl?.trim();
    const webhookUrl =
      trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined;
    if (
      webhookUrl !== undefined &&
      (!webhookUrl.startsWith("https://") ||
        webhookUrl.length > MAX_WEBHOOK_URL_LENGTH)
    ) {
      throw new ConvexError("invalid_config");
    }
    if (args.webhookEnabled && webhookUrl === undefined) {
      throw new ConvexError("invalid_config");
    }

    const value = { webhookEnabled: args.webhookEnabled, webhookUrl };
    const existing = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", SETTINGS_KEY))
      .unique();
    if (existing) {
      await ctx.db.patch("settings", existing._id, { value });
    } else {
      await ctx.db.insert("settings", { key: SETTINGS_KEY, value });
    }
    await logAudit(ctx, {
      actorType: "staff",
      actorId: staff.id,
      action: "settings.channels",
      targetType: "settings",
      targetId: SETTINGS_KEY,
      meta: {
        webhookEnabled: args.webhookEnabled,
        hasWebhookUrl: webhookUrl !== undefined,
      },
    });
    return null;
  },
});

/**
 * Guardian phones for a recipient batch (delivery action only). Students
 * without a guardianPhone are skipped; the action dedupes shared phones.
 * Sliced to the notify fan-out cap (2000) defensively.
 */
export const guardianPhonesInternal = internalQuery({
  args: { studentIds: v.array(v.id("students")) },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    const phones: Array<string> = [];
    for (const studentId of args.studentIds.slice(0, 2000)) {
      const student = await ctx.db.get("students", studentId);
      const phone = student?.guardianPhone?.trim();
      if (phone !== undefined && phone.length > 0) phones.push(phone);
    }
    return phones;
  },
});
