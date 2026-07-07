import { v } from "convex/values";
import { query } from "./_generated/server";

// Public health query — proves the Convex live-query round trip on the
// landing page. Returns nothing sensitive.
export const health = query({
  args: {},
  returns: v.object({
    ok: v.boolean(),
    now: v.number(),
    hasActiveTerm: v.boolean(),
  }),
  handler: async (ctx) => {
    const anyTerm = await ctx.db.query("terms").first();
    return {
      ok: true,
      now: Date.now(),
      hasActiveTerm: anyTerm?.active === true,
    };
  },
});
