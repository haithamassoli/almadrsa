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

export const attendanceStatus = v.union(
  v.literal("present"),
  v.literal("absent"),
  v.literal("late"),
);
export const lessonSource = v.union(
  v.literal("timetable"),
  v.literal("adhoc"),
);

export type StaffRole = "admin" | "teacher";
export type AttendanceStatus = "present" | "absent" | "late";
export type LessonSource = "timetable" | "adhoc";
