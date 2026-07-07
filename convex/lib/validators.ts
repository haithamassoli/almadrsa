import { v } from "convex/values";

// Shared validators — single source of truth for enums used across schema,
// function args, and UI types.
export const staffRole = v.union(v.literal("admin"), v.literal("teacher"));
export const codeStatus = v.union(v.literal("active"), v.literal("revoked"));
export const studentStatus = v.union(
  v.literal("active"),
  v.literal("archived"),
);
export const actorType = v.union(
  v.literal("staff"),
  v.literal("student"),
  v.literal("system"),
);

export type StaffRole = "admin" | "teacher";
