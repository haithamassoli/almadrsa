import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

/**
 * M15 — outbound guardian-channel delivery (default runtime; `fetch` needs
 * no Node). Scheduled exactly once per notify fan-out by
 * lib/channels.sendViaChannels AFTER the in-app rows commit. Strictly
 * best-effort: any failure is logged and never retried — the in-app
 * notification row is the source of truth.
 *
 * The adapter is deliberately generic: one POST of
 *   { messages: [{ phone, title, body }] }
 * to the configured HTTPS webhook. A school points it at its own bridge
 * (Twilio, WhatsApp Business API, an SMS gateway relay, …) which owns
 * provider auth, templating and retries.
 * ponytail: one webhook instead of N provider SDKs — swap in a first-party
 * integration only when a school actually needs one.
 */
export const deliver = internalAction({
  args: {
    studentIds: v.array(v.id("students")),
    title: v.string(),
    body: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Re-read the config at delivery time — the admin may have flipped the
    // switch between the mutation and this action.
    const config: { webhookEnabled: boolean; webhookUrl?: string } =
      await ctx.runQuery(internal.admin.channelsConfigInternal, {});
    if (!config.webhookEnabled || config.webhookUrl === undefined) {
      return null;
    }

    // Students without a guardianPhone are skipped by the query; siblings
    // sharing one guardian phone dedupe to a single identical message.
    const phones: Array<string> = await ctx.runQuery(
      internal.admin.guardianPhonesInternal,
      { studentIds: args.studentIds },
    );
    const unique = [...new Set(phones)];
    if (unique.length === 0) return null;

    const payload = {
      messages: unique.map((phone) => ({
        phone,
        title: args.title,
        body: args.body,
      })),
    };
    try {
      const response = await fetch(config.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        console.error(
          `channels: webhook answered ${response.status} for ${unique.length} messages`,
        );
      } else {
        console.log(`channels: delivered ${unique.length} messages`);
      }
    } catch (error) {
      console.error(
        "channels: webhook delivery failed",
        error instanceof Error ? error.message : String(error),
      );
    }
    return null;
  },
});
