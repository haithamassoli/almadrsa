import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";

/**
 * M15 — guardian message channels (WhatsApp/SMS-ready). The school
 * configures ONE generic outbound webhook (settings key "channels", managed
 * in convex/admin.ts); every notification fan-out mirrors its title/body to
 * the guardians' phones through it. Disabled by default — reading the
 * config inside the mutation makes "off" a true no-op (nothing scheduled).
 */

export type ChannelsConfig = {
  webhookEnabled: boolean;
  webhookUrl?: string;
};

const SETTINGS_KEY = "channels";

/**
 * The effective channels config: the "channels" settings row, field-
 * validated at read (like gamification.readConfig) so a hand-edited row can
 * never enable delivery without a plausible https URL. Missing row ⇒
 * disabled.
 */
export async function readChannelsConfig(
  ctx: QueryCtx,
): Promise<ChannelsConfig> {
  const row = await ctx.db
    .query("settings")
    .withIndex("by_key", (q) => q.eq("key", SETTINGS_KEY))
    .unique();
  const stored =
    row !== null && typeof row.value === "object" && row.value !== null
      ? (row.value as Record<string, unknown>)
      : {};
  const webhookUrl =
    typeof stored.webhookUrl === "string" &&
    stored.webhookUrl.startsWith("https://")
      ? stored.webhookUrl
      : undefined;
  return {
    webhookEnabled: stored.webhookEnabled === true && webhookUrl !== undefined,
    webhookUrl,
  };
}

/**
 * Mirror one notification to the guardian channels: no-op while disabled,
 * otherwise schedule a single delivery action for the whole recipient
 * batch. Called from notifyStudents (the single notification choke point),
 * so the schedule commits — or rolls back — atomically with the in-app rows.
 */
export async function sendViaChannels(
  ctx: MutationCtx,
  args: { studentIds: Array<Id<"students">>; title: string; body: string },
): Promise<void> {
  const config = await readChannelsConfig(ctx);
  if (!config.webhookEnabled) return;
  await ctx.scheduler.runAfter(0, internal.channelActions.deliver, {
    studentIds: args.studentIds,
    title: args.title,
    body: args.body,
  });
}
