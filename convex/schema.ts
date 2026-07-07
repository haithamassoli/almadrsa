import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  actorType,
  announcementScope,
  attemptStatus,
  attendanceStatus,
  codeStatus,
  difficulty,
  examStatus,
  lessonSource,
  notificationType,
  questionType,
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

  // ——— Exam engine v1 (MCQ + true/false) ———
  questions: defineTable({
    teacherId: v.string(), // creator, Better Auth user id
    subjectId: v.id("subjects"),
    type: questionType,
    text: v.string(),
    options: v.array(v.object({ id: v.string(), text: v.string() })), // mcq 2–6; truefalse []
    correctOptionId: v.optional(v.string()), // mcq only
    correctBool: v.optional(v.boolean()), // truefalse only
    topic: v.optional(v.string()),
    difficulty: difficulty,
    archived: v.boolean(),
  })
    .index("by_subjectId", ["subjectId"])
    .index("by_teacherId", ["teacherId"]),

  exams: defineTable({
    title: v.string(),
    teacherId: v.string(), // Better Auth user id (owner)
    classId: v.id("classes"),
    subjectId: v.id("subjects"),
    // 1–100 items, enforced in mutations. Marks are frozen per exam so later
    // question edits never change published grading.
    questions: v.array(
      v.object({ questionId: v.id("questions"), marks: v.number() }),
    ),
    windowStart: v.number(), // ms
    windowEnd: v.number(), // ms
    timeLimitMinutes: v.number(),
    status: examStatus,
    totalMarks: v.number(), // denormalized sum of question marks
    closeFnId: v.optional(v.id("_scheduled_functions")), // auto-close at windowEnd
  })
    .index("by_teacherId", ["teacherId"])
    .index("by_classId_and_status", ["classId", "status"]),

  examAttempts: defineTable({
    examId: v.id("exams"),
    studentId: v.id("students"),
    startedAt: v.number(),
    deadlineAt: v.number(), // min(startedAt + timeLimit, windowEnd)
    submittedAt: v.optional(v.number()),
    status: attemptStatus,
    answers: v.record(v.id("questions"), v.union(v.string(), v.boolean())),
    autoScore: v.optional(v.number()), // set on submit/expire/close
    maxScore: v.number(), // exam.totalMarks at start time
    overrideScore: v.optional(v.number()),
    overrideBy: v.optional(v.string()), // Better Auth user id
    overrideAt: v.optional(v.number()),
    expireFnId: v.optional(v.id("_scheduled_functions")), // auto-submit at deadline
  })
    .index("by_examId_and_studentId", ["examId", "studentId"])
    .index("by_examId", ["examId"])
    .index("by_studentId", ["studentId"]),

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

  // ——— M5: teacher notes, announcements & in-app notifications ———
  notes: defineTable({
    studentId: v.id("students"),
    teacherId: v.string(), // Better Auth user id (author)
    text: v.string(),
  })
    .index("by_studentId", ["studentId"])
    .index("by_teacherId", ["teacherId"]),

  announcements: defineTable({
    scope: announcementScope,
    classId: v.optional(v.id("classes")), // set iff scope === "class"
    title: v.string(),
    body: v.string(),
    authorId: v.string(), // Better Auth user id · "system" for seeded rows
    authorName: v.string(), // denormalized at write; later renames don't backfill
  })
    .index("by_scope", ["scope"])
    .index("by_classId", ["classId"]),

  notifications: defineTable({
    studentId: v.id("students"),
    type: notificationType,
    title: v.string(),
    body: v.string(),
    read: v.boolean(),
    refType: v.optional(v.string()), // "exam" · "note" · "announcement" · "attendance"
    refId: v.optional(v.string()),
  })
    .index("by_studentId", ["studentId"])
    .index("by_studentId_and_read", ["studentId", "read"]),

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
