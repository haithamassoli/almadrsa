"use node";

import { v } from "convex/values";
import webpush from "web-push";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/**
 * M12 — web-push delivery (Node runtime, `web-push`). Scheduled exactly once
 * per notify fan-out (convex/lib/notify.ts) AFTER the in-app rows commit —
 * the scheduler only runs this if the surrounding mutation succeeded. Push is
 * strictly best-effort: any failure is logged and never retried, the in-app
 * notification row is the source of truth.
 *
 * VAPID keys live ONLY in Convex deployment env vars (VAPID_PRIVATE_KEY is
 * never sent to a client); the browser gets the public half via
 * NEXT_PUBLIC_VAPID_PUBLIC_KEY.
 */

/** listByStudents slices to 100 ids — keep the batches within that. */
const STUDENTS_PER_BATCH = 100;
/** Concurrent HTTP requests to the push services per wave. */
const SENDS_PER_WAVE = 20;

/** Payload contract shared with the service worker (app/sw.ts push handler). */
type PushPayload = { title: string; body: string; url: string };

type SubscriptionRow = {
  _id: Id<"pushSubscriptions">;
  endpoint: string;
  p256dh: string;
  auth: string;
};

export const deliver = internalAction({
  args: {
    studentIds: v.array(v.id("students")),
    title: v.string(),
    body: v.string(),
    url: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT;
    if (!publicKey || !privateKey || !subject) {
      console.log("push: VAPID env vars not set — skipping delivery");
      return null;
    }
    webpush.setVapidDetails(subject, publicKey, privateKey);

    const payload: PushPayload = {
      title: args.title,
      body: args.body,
      url: args.url,
    };
    const serialized = JSON.stringify(payload);

    let sent = 0;
    let dropped = 0;
    for (
      let offset = 0;
      offset < args.studentIds.length;
      offset += STUDENTS_PER_BATCH
    ) {
      const subscriptions: SubscriptionRow[] = await ctx.runQuery(
        internal.push.listByStudents,
        {
          studentIds: args.studentIds.slice(
            offset,
            offset + STUDENTS_PER_BATCH,
          ),
        },
      );
      for (let i = 0; i < subscriptions.length; i += SENDS_PER_WAVE) {
        const wave = subscriptions.slice(i, i + SENDS_PER_WAVE);
        const results = await Promise.allSettled(
          wave.map((subscription) =>
            webpush.sendNotification(
              {
                endpoint: subscription.endpoint,
                keys: {
                  p256dh: subscription.p256dh,
                  auth: subscription.auth,
                },
              },
              serialized,
              { TTL: 24 * 60 * 60, urgency: "normal" },
            ),
          ),
        );
        for (const [index, result] of results.entries()) {
          if (result.status === "fulfilled") {
            sent += 1;
            continue;
          }
          const statusCode = (result.reason as { statusCode?: number })
            ?.statusCode;
          if (statusCode === 404 || statusCode === 410) {
            // The push service says this endpoint is gone — drop the row.
            await ctx.runMutation(internal.push.removeById, {
              subscriptionId: wave[index]._id,
            });
            dropped += 1;
          } else {
            console.error(
              `push: send failed (status ${statusCode ?? "?"})`,
              result.reason instanceof Error
                ? result.reason.message
                : String(result.reason),
            );
          }
        }
      }
    }
    if (sent > 0 || dropped > 0) {
      console.log(`push: delivered ${sent}, dropped ${dropped} dead endpoints`);
    }
    return null;
  },
});
