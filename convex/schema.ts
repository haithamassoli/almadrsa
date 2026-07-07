import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  actorType,
  attendanceStatus,
  codeStatus,
  lessonSource,
  studentStatus,
} from "./lib/validators";

// Staff (admin/teacher) live in the Better Auth component's user table and are
// referenced from app tables by their Better Auth user id (string).
// Single-tenant: adding a schoolId column later must not be blocked — no
// cross-table assumptions of global uniqueness beyond ids.
export default defineSchema({
  // ——— People ———
  students: defineTable({
    firstName: v.string(),
    lastName: v.string(),
    guardianName: v.optional(v.string()),
    guardianPhone: v.optional(v.string()),
    status: studentStatus,
  }).index("by_status", ["status"]),

  enrollments: defineTable({
    studentId: v.id("students"),
    classId: v.id("classes"),
    active: v.boolean(),
  })
    .index("by_studentId_and_active", ["studentId", "active"])
    .index("by_classId_and_active", ["classId", "active"]),

  // ——— Academic structure ———
  grades: defineTable({
    name: v.string(),
    order: v.number(),
  }).index("by_order", ["order"]),

  subjects: defineTable({
    name: v.string(),
    gradeId: v.id("grades"),
  }).index("by_gradeId", ["gradeId"]),

  classes: defineTable({
    name: v.string(),
    gradeId: v.id("grades"),
  }).index("by_gradeId", ["gradeId"]),

  terms: defineTable({
    name: v.string(),
    startDate: v.number(),
    endDate: v.number(),
    active: v.boolean(),
  }).index("by_active", ["active"]),

  teacherAssignments: defineTable({
    teacherId: v.string(), // Better Auth user id
    subjectId: v.id("subjects"),
    classId: v.id("classes"),
  })
    .index("by_teacherId", ["teacherId"])
    .index("by_classId", ["classId"])
    .index("by_subjectId_and_classId", ["subjectId", "classId"]),

  gradeWeights: defineTable({
    subjectId: v.id("subjects"),
    examsPct: v.number(),
    homeworkPct: v.number(),
    participationPct: v.number(),
  }).index("by_subjectId", ["subjectId"]),

  // ——— Timetable, lessons & attendance ———
  timetableSlots: defineTable({
    classId: v.id("classes"),
    weekday: v.number(), // 0=Sunday … 6; school week uses 0–4 (Sun–Thu)
    period: v.number(), // 1..8
    subjectId: v.id("subjects"),
    teacherId: v.string(), // Better Auth user id
  })
    .index("by_classId_and_weekday", ["classId", "weekday"])
    .index("by_teacherId_and_weekday", ["teacherId", "weekday"]),

  lessons: defineTable({
    classId: v.id("classes"),
    subjectId: v.id("subjects"),
    teacherId: v.string(), // Better Auth user id
    date: v.string(), // "YYYY-MM-DD" date key
    period: v.number(),
    source: lessonSource, // materialized from a slot vs. created ad hoc
    timetableSlotId: v.optional(v.id("timetableSlots")),
    title: v.optional(v.string()),
    notes: v.optional(v.string()),
    resources: v.array(v.object({ title: v.string(), url: v.string() })), // ≤10, enforced in mutations
  })
    .index("by_teacherId_and_date", ["teacherId", "date"])
    .index("by_classId_and_date", ["classId", "date"])
    .index("by_timetableSlotId_and_date", ["timetableSlotId", "date"]),

  attendance: defineTable({
    lessonId: v.id("lessons"),
    studentId: v.id("students"),
    classId: v.id("classes"), // denormalized from the lesson
    date: v.string(), // denormalized from the lesson
    status: attendanceStatus,
    markedBy: v.string(), // Better Auth user id
    updatedAt: v.number(),
  })
    .index("by_lessonId_and_studentId", ["lessonId", "studentId"])
    .index("by_studentId_and_date", ["studentId", "date"]),

  // ——— Student/parent code auth (custom, hash-only) ———
  accessCodes: defineTable({
    studentId: v.id("students"),
    codeHash: v.string(), // SHA-256 of a ≥128-bit random code; plaintext never stored
    status: codeStatus,
    pinHash: v.optional(v.string()), // PBKDF2, set on first login if chosen
    pinSalt: v.optional(v.string()),
    createdBy: v.string(), // Better Auth user id of issuing staff
    revokedAt: v.optional(v.number()),
    lastLoginAt: v.optional(v.number()),
  })
    .index("by_codeHash", ["codeHash"])
    .index("by_studentId_and_status", ["studentId", "status"]),

  studentSessions: defineTable({
    accessCodeId: v.id("accessCodes"),
    studentId: v.id("students"),
    tokenHash: v.string(),
    expiresAt: v.number(),
  })
    .index("by_tokenHash", ["tokenHash"])
    .index("by_accessCodeId", ["accessCodeId"]),

  rememberedDevices: defineTable({
    accessCodeId: v.id("accessCodes"),
    deviceTokenHash: v.string(),
    lastSeenAt: v.number(),
  })
    .index("by_deviceTokenHash", ["deviceTokenHash"])
    .index("by_accessCodeId", ["accessCodeId"]),

  // ——— Cross-cutting ———
  auditLog: defineTable({
    actorType: actorType,
    actorId: v.string(), // staff: Better Auth id · student: accessCode id · system: "system"
    action: v.string(), // e.g. "code.login", "code.regenerate", "student.delete"
    targetType: v.optional(v.string()),
    targetId: v.optional(v.string()),
    meta: v.optional(v.record(v.string(), v.any())),
    ip: v.optional(v.string()),
  })
    .index("by_actorId", ["actorId"])
    .index("by_action", ["action"]),

  settings: defineTable({
    key: v.string(),
    value: v.any(),
  }).index("by_key", ["key"]),
});
