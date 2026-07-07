import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins";
import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import authConfig from "./auth.config";
import authSchema from "./betterAuth/schema";
import type { StaffRole } from "./lib/validators";

const siteUrl = process.env.SITE_URL!;

export const authComponent = createClient<DataModel, typeof authSchema>(
  components.betterAuth,
  {
    local: {
      schema: authSchema,
    },
  },
);

export const createAuthOptions = (ctx: GenericCtx<DataModel>) =>
  ({
    baseURL: siteUrl,
    database: authComponent.adapter(ctx),
    trustedOrigins: [siteUrl],
    emailAndPassword: {
      enabled: true,
      // Staff accounts are created by an admin (or the seed bootstrap), never
      // by public signup.
      disableSignUp: true,
      requireEmailVerification: false,
    },
    plugins: [
      admin({ defaultRole: "teacher", adminRoles: ["admin"] }),
      convex({ authConfig }),
    ],
  }) satisfies Parameters<typeof betterAuth>[0];

export const createAuth = (ctx: GenericCtx<DataModel>) =>
  betterAuth(createAuthOptions(ctx));

export type StaffUser = {
  id: string; // Better Auth user id — what app tables reference
  name: string;
  email: string;
  role: StaffRole;
  banned: boolean;
};

function toStaffUser(user: {
  _id: string;
  userId?: string | null;
  name: string;
  email: string;
  role?: string | null;
  banned?: boolean | null;
}): StaffUser {
  return {
    id: user.userId ?? user._id,
    name: user.name,
    email: user.email,
    role: user.role === "admin" ? "admin" : "teacher",
    banned: user.banned === true,
  };
}

// ——— Server-side guards. Every staff-facing Convex function calls one of
// these; client-side checks are cosmetic only. ———

export async function requireStaff(
  ctx: QueryCtx | GenericCtx<DataModel>,
): Promise<StaffUser> {
  const user = await authComponent.safeGetAuthUser(
    ctx as GenericCtx<DataModel>,
  );
  if (!user) throw new Error("Not authenticated");
  const staff = toStaffUser(user);
  if (staff.banned) throw new Error("Account disabled");
  return staff;
}

export async function requireAdmin(
  ctx: QueryCtx | GenericCtx<DataModel>,
): Promise<StaffUser> {
  const staff = await requireStaff(ctx);
  if (staff.role !== "admin") throw new Error("Unauthorized: admin only");
  return staff;
}

// Admins may do everything a teacher can.
export async function requireTeacher(
  ctx: QueryCtx | GenericCtx<DataModel>,
): Promise<StaffUser> {
  const staff = await requireStaff(ctx);
  if (staff.role !== "teacher" && staff.role !== "admin") {
    throw new Error("Unauthorized: staff only");
  }
  return staff;
}
