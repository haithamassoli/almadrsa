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
  homeworkStatus,
  lessonSource,
  notificationType,
  questionType,
  reportStatus,
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

  // ——— Exam engine (M4: mcq/truefalse · M8: fillblank/matching/ordering/essay) ———
  questions: defineTable({
    teacherId: v.string(), // creator, Better Auth user id
    subjectId: v.id("subjects"),
    type: questionType,
    text: v.string(),
    options: v.array(v.object({ id: v.string(), text: v.string() })), // mcq 2–6; every other type []
    correctOptionId: v.optional(v.string()), // mcq only
    correctBool: v.optional(v.boolean()), // truefalse only
    // fillblank only: text carries one "____" placeholder (run of ≥4
    // underscores) per blank, in blank order.
    blanks: v.optional(
      v.array(
        v.object({ id: v.string(), acceptedAnswers: v.array(v.string()) }),
      ),
    ),
    // matching only (2–8). left[i] ↔ right[i] of the SAME pair is correct.
    pairs: v.optional(
      v.array(
        v.object({ id: v.string(), left: v.string(), right: v.string() }),
      ),
    ),
    // ordering only (2–8). DOC ORDER IS THE CORRECT ORDER — never send it
    // to students unshuffled.
    items: v.optional(v.array(v.object({ id: v.string(), text: v.string() }))),
    rubricText: v.optional(v.string()), // essay only, teacher-side guide ≤2000
    imageId: v.optional(v.id("_storage")), // any type
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
    shuffle: v.optional(v.boolean()), // undefined ⇒ true (question/option order)
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
    // Per-type answer values: mcq → option id (string) · truefalse → boolean
    // · essay → free text (string) · fillblank → string[] in blank order ·
    // ordering → item ids in chosen order (string[]) · matching → record
    // leftPairId → chosen rightPairId.
    answers: v.record(
      v.id("questions"),
      v.union(
        v.string(),
        v.boolean(),
        v.array(v.string()),
        v.record(v.string(), v.string()),
      ),
    ),
    autoScore: v.optional(v.number()), // set on submit/expire/close (essays = 0)
    maxScore: v.number(), // exam.totalMarks at start time
    overrideScore: v.optional(v.number()),
    overrideBy: v.optional(v.string()), // Better Auth user id
    overrideAt: v.optional(v.number()),
    // M8 — deterministic shuffle seed (djb2 of the attempt id), set at start.
    seed: v.optional(v.number()),
    // M8 — manual essay grading. gradedAt/gradedBy stamp when EVERY essay
    // question has a manual score; results stay hidden until then.
    manualScores: v.optional(v.record(v.id("questions"), v.number())),
    feedback: v.optional(
      v.record(
        v.id("questions"),
        v.object({
          text: v.optional(v.string()),
          audioId: v.optional(v.id("_storage")),
        }),
      ),
    ),
    gradedAt: v.optional(v.number()),
    gradedBy: v.optional(v.string()), // Better Auth user id
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
    refType: v.optional(v.string()), // "exam" · "note" · "announcement" · "attendance" · "homework" · "report"
    refId: v.optional(v.string()),
  })
    .index("by_studentId", ["studentId"])
    .index("by_studentId_and_read", ["studentId", "read"]),

  // ——— M6: gamification v1 (points + streaks; M9 adds homework awards) ———
  pointEvents: defineTable({
    studentId: v.id("students"),
    kind: v.union(
      v.literal("attendance"),
      v.literal("exam"),
      v.literal("homework"),
    ),
    points: v.number(),
    refType: v.string(), // "attendance" · "attempt" · "submission"
    refId: v.string(), // id of the awarding row — the dedupe key
    day: v.string(), // "YYYY-MM-DD"
  })
    .index("by_studentId", ["studentId"])
    .index("by_refType_and_refId", ["refType", "refId"]),

  gamification: defineTable({
    studentId: v.id("students"),
    totalPoints: v.number(),
    streak: v.number(), // consecutive active days (≤3-day gaps tolerated)
    lastActiveDay: v.optional(v.string()), // "YYYY-MM-DD"; only moves forward
  })
    .index("by_studentId", ["studentId"])
    .index("by_totalPoints", ["totalPoints"]), // M10: school leaderboard / rank scans

  // ——— M9: homework ———
  homework: defineTable({
    classId: v.id("classes"),
    subjectId: v.id("subjects"),
    teacherId: v.string(), // Better Auth user id (owner)
    title: v.string(), // nonempty, ≤200 — enforced in mutations
    description: v.optional(v.string()), // ≤4000
    deadline: v.number(), // ms; auto-close scheduled here
    marks: v.number(), // max grade, 1–100 (UI defaults to 10)
    status: homeworkStatus,
    closeFnId: v.optional(v.id("_scheduled_functions")), // auto-close at deadline
    reminderFnId: v.optional(v.id("_scheduled_functions")), // ~24h-before nudge
  })
    .index("by_classId", ["classId"])
    .index("by_teacherId", ["teacherId"]),

  homeworkSubmissions: defineTable({
    homeworkId: v.id("homework"),
    studentId: v.id("students"),
    text: v.optional(v.string()), // ≤8000, enforced in mutations
    fileIds: v.array(v.id("_storage")), // ≤5 images/PDFs, validated at submit
    audioId: v.optional(v.id("_storage")), // one voice note
    submittedAt: v.number(), // first submission time; edits never move it
    updatedAt: v.number(),
    grade: v.optional(v.number()), // 0..homework.marks
    feedbackText: v.optional(v.string()),
    gradedAt: v.optional(v.number()),
    gradedBy: v.optional(v.string()), // Better Auth user id
  })
    .index("by_homeworkId_and_studentId", ["homeworkId", "studentId"])
    .index("by_homeworkId", ["homeworkId"])
    .index("by_studentId", ["studentId"]),

  // ——— M11: term report cards ———
  // One snapshot per (student, term), recomputed on demand while draft and
  // frozen forever once published. Subject rows denormalize names/weights at
  // compute time so later renames or weight edits never rewrite history.
  reportCards: defineTable({
    studentId: v.id("students"),
    termId: v.id("terms"),
    classId: v.id("classes"), // class the snapshot was computed against
    status: reportStatus, // draft (recomputable) · published (immutable)
    remarks: v.optional(v.string()), // teacher remarks, ≤2000 — mutations enforce
    subjects: v.array(
      v.object({
        subjectId: v.id("subjects"),
        subjectName: v.string(), // denormalized at compute
        // Component averages 0–100 (1dp); undefined = no data in the term.
        examsPct: v.optional(v.number()),
        homeworkPct: v.optional(v.number()),
        participationPct: v.optional(v.number()),
        // The gradeWeights row (or the 60/20/20 default) as of compute time.
        weights: v.object({
          exams: v.number(),
          homework: v.number(),
          participation: v.number(),
        }),
        // Weighted over the AVAILABLE components (weights renormalized);
        // 0 when no component has data.
        finalPct: v.number(),
      }),
    ),
    // Whole-class attendance summary for the term (all subjects).
    attendance: v.object({
      present: v.number(),
      late: v.number(),
      absent: v.number(),
      rate: v.number(), // (present+late)/marked · 100, 1dp; 0 when unmarked
    }),
    computedAt: v.number(),
    publishedAt: v.optional(v.number()),
    publishedBy: v.optional(v.string()), // Better Auth user id
  })
    .index("by_studentId_and_termId", ["studentId", "termId"])
    .index("by_classId_and_termId", ["classId", "termId"]),

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
