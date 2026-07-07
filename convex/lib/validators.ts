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

// M4 — exam engine
export const questionType = v.union(v.literal("mcq"), v.literal("truefalse"));
export const difficulty = v.union(
  v.literal("easy"),
  v.literal("medium"),
  v.literal("hard"),
);
export const examStatus = v.union(
  v.literal("draft"),
  v.literal("published"),
  v.literal("closed"),
);
export const attemptStatus = v.union(
  v.literal("in_progress"),
  v.literal("submitted"),
);

export type StaffRole = "admin" | "teacher";
export type AttendanceStatus = "present" | "absent" | "late";
export type LessonSource = "timetable" | "adhoc";
export type QuestionType = "mcq" | "truefalse";
export type Difficulty = "easy" | "medium" | "hard";
export type ExamStatus = "draft" | "published" | "closed";
export type AttemptStatus = "in_progress" | "submitted";
