import { v } from "convex/values";
import { action, query } from "./_generated/server";
import { components, internal } from "./_generated/api";
import { authComponent, createAuth, requireAdmin } from "./auth";
import { staffRole } from "./lib/validators";

/**
 * Staff account surface. Accounts live in the Better Auth component's `user`
 * table; app tables reference them by Better Auth user id (string). Account
 * creation/banning go through the Better Auth admin plugin API (actions),
 * authorized by `requireAdmin` server-side.
 */

type StaffListEntry = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "teacher";
  banned: boolean;
};

function toRole(role: unknown): "admin" | "teacher" {
  return role === "admin" ? "admin" : "teacher";
}

/**
 * Per API contract: {id,name,email,role} | null — never throws. Returns null
 * when signed out, banned, or on any auth-component error.
 */
export const currentUser = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      id: v.string(),
      name: v.string(),
      email: v.string(),
      role: staffRole,
    }),
  ),
  handler: async (ctx) => {
    try {
      const user = await authComponent.safeGetAuthUser(ctx);
      if (!user) return null;
      if (user.banned === true) return null;
      return {
        id: user.userId ?? user._id,
        name: user.name,
        email: user.email,
        role: toRole(user.role),
      };
    } catch {
      return null;
    }
  },
});

/** Admin-only: create a staff account (public signup is disabled). */
export const createStaffAccount = action({
  args: {
    email: v.string(),
    password: v.string(),
    name: v.string(),
    role: staffRole,
  },
  returns: v.object({ userId: v.string() }),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const { auth, headers } = await authComponent.getAuth(createAuth, ctx);
    const created = await auth.api.createUser({
      body: {
        email: args.email,
        password: args.password,
        name: args.name,
        // Better Auth types roles as "admin" | "user"; runtime accepts any
        // string and our defaultRole/adminRoles config uses admin | teacher.
        role: args.role as "admin",
      },
      headers,
    });
    await ctx.runMutation(internal.lib.audit.record, {
      actorType: "staff",
      actorId: admin.id,
      action: "staff.create",
      targetType: "staffUser",
      targetId: created.user.id,
      meta: { email: args.email, role: args.role },
    });
    return { userId: created.user.id };
  },
});

/** Admin-only: disable (ban) or re-enable a staff account. */
export const setStaffBanned = action({
  args: { userId: v.string(), banned: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    if (args.userId === admin.id) {
      throw new Error("Cannot change your own account status");
    }
    const { auth, headers } = await authComponent.getAuth(createAuth, ctx);
    if (args.banned) {
      await auth.api.banUser({ body: { userId: args.userId }, headers });
    } else {
      await auth.api.unbanUser({ body: { userId: args.userId }, headers });
    }
    await ctx.runMutation(internal.lib.audit.record, {
      actorType: "staff",
      actorId: admin.id,
      action: args.banned ? "staff.disable" : "staff.enable",
      targetType: "staffUser",
      targetId: args.userId,
    });
    return null;
  },
});

/** Admin-only: bounded staff directory straight from the Better Auth table. */
export const listStaff = query({
  args: {},
  returns: v.array(
    v.object({
      id: v.string(),
      name: v.string(),
      email: v.string(),
      role: staffRole,
      banned: v.boolean(),
    }),
  ),
  handler: async (ctx): Promise<Array<StaffListEntry>> => {
    await requireAdmin(ctx);
    const result = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: "user",
      paginationOpts: { numItems: 200, cursor: null },
      sortBy: { field: "createdAt", direction: "asc" },
    });
    const page = (result?.page ?? []) as Array<{
      _id: string;
      userId?: string | null;
      name?: string | null;
      email?: string | null;
      role?: string | null;
      banned?: boolean | null;
    }>;
    return page.map((user) => ({
      id: user.userId ?? user._id,
      name: user.name ?? "",
      email: user.email ?? "",
      role: toRole(user.role),
      banned: user.banned === true,
    }));
  },
});
