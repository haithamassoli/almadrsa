import { v } from "convex/values";
import { internalAction, internalMutation } from "./_generated/server";
import { components } from "./_generated/api";
import { createAuth } from "./auth";
import { issueCodeCore } from "./codes";
import { notifyAllActiveStudents } from "./lib/notify";
import { staffRole } from "./lib/validators";

// Bootstrap staff accounts from the CLI (never exposed publicly):
//   npx convex run seed:createStaff '{"email":"...","password":"...","name":"...","role":"admin"}'
export const createStaff = internalAction({
  args: {
    email: v.string(),
    password: v.string(),
    name: v.string(),
    role: staffRole,
  },
  returns: v.object({ userId: v.string() }),
  handler: async (ctx, args) => {
    const auth = createAuth(ctx);
    const created = await auth.api.createUser({
      body: {
        email: args.email,
        password: args.password,
        name: args.name,
        // Better Auth types roles as "admin" | "user"; runtime accepts any
        // string and our defaultRole/adminRoles config uses admin | teacher.
        role: args.role as "admin",
      },
    });
    return { userId: created.user.id };
  },
});

// ————————————————————————————————————————————————————————————————————————
// Demo data — grade 4 with one class, one active term, 3 subjects, the
// seeded teacher assigned to all of them, and 8 enrolled students.
//   npx convex run seed:seedDemo '{}'
// Deliberately does NOT issue access codes: plaintext codes must only ever
// come out of codes.issueCode.
// ————————————————————————————————————————————————————————————————————————

const DEMO_GRADE_NAME = "الصف الرابع";
const DEMO_GRADE_ORDER = 4;
const DEMO_CLASS_NAME = "الصف الرابع — أ";
const DEMO_TERM_NAME = "الفصل الأول ٢٠٢٦/٢٠٢٧";
const DEMO_SUBJECTS = ["التربية الإسلامية", "اللغة العربية", "الرياضيات"];
const DEMO_TEACHER_EMAIL = "teacher@almadrasa.dev";
const DEMO_STUDENTS: Array<{ firstName: string; lastName: string }> = [
  { firstName: "أحمد", lastName: "الخطيب" },
  { firstName: "محمد", lastName: "العمري" },
  { firstName: "يوسف", lastName: "الحموي" },
  { firstName: "عمر", lastName: "النابلسي" },
  { firstName: "ليان", lastName: "الشامي" },
  { firstName: "سارة", lastName: "الحلبي" },
  { firstName: "مريم", lastName: "القاسم" },
  { firstName: "نور", lastName: "الدمشقي" },
];

export const seedDemo = internalMutation({
  args: {
    // Normally resolved from the Better Auth user table by email; pass
    // explicitly if the seeded teacher account has a different email.
    teacherId: v.optional(v.string()),
  },
  returns: v.object({
    skipped: v.boolean(),
    teacherResolved: v.boolean(),
    students: v.number(),
    subjects: v.number(),
    assignments: v.number(),
  }),
  handler: async (ctx, args) => {
    // Idempotent-ish: skip when the demo grade already exists.
    const gradesAtOrder = await ctx.db
      .query("grades")
      .withIndex("by_order", (q) => q.eq("order", DEMO_GRADE_ORDER))
      .take(10);
    if (gradesAtOrder.some((grade) => grade.name === DEMO_GRADE_NAME)) {
      return {
        skipped: true,
        teacherResolved: false,
        students: 0,
        subjects: 0,
        assignments: 0,
      };
    }

    // Resolve the seeded teacher's Better Auth user id by email.
    let teacherId = args.teacherId;
    if (teacherId === undefined) {
      const teacher: { _id: string; userId?: string | null } | null =
        await ctx.runQuery(components.betterAuth.adapter.findOne, {
          model: "user",
          where: [{ field: "email", value: DEMO_TEACHER_EMAIL }],
        });
      if (teacher) teacherId = teacher.userId ?? teacher._id;
    }

    const gradeId = await ctx.db.insert("grades", {
      name: DEMO_GRADE_NAME,
      order: DEMO_GRADE_ORDER,
    });
    const classId = await ctx.db.insert("classes", {
      name: DEMO_CLASS_NAME,
      gradeId,
    });
    await ctx.db.insert("terms", {
      name: DEMO_TERM_NAME,
      startDate: Date.UTC(2026, 8, 1), // 2026-09-01
      endDate: Date.UTC(2027, 0, 31), // 2027-01-31
      active: true,
    });

    const subjectIds = [];
    for (const name of DEMO_SUBJECTS) {
      subjectIds.push(await ctx.db.insert("subjects", { name, gradeId }));
    }

    let assignments = 0;
    if (teacherId !== undefined) {
      for (const subjectId of subjectIds) {
        await ctx.db.insert("teacherAssignments", {
          teacherId,
          subjectId,
          classId,
        });
        assignments++;
      }
    }

    for (const student of DEMO_STUDENTS) {
      const studentId = await ctx.db.insert("students", {
        firstName: student.firstName,
        lastName: student.lastName,
        status: "active",
      });
      await ctx.db.insert("enrollments", { studentId, classId, active: true });
    }

    return {
      skipped: false,
      teacherResolved: teacherId !== undefined,
      students: DEMO_STUDENTS.length,
      subjects: subjectIds.length,
      assignments,
    };
  },
});

/**
 * M3 demo timetable for the seeded demo class: Sunday–Thursday (weekday
 * 0–4), periods 1–3, rotating through the demo subjects, all taught by the
 * demo teacher. Idempotent — existing (class, weekday, period) slots are
 * kept. Returns the number of slots created.
 *   npx convex run seed:seedTimetable '{}'
 */
export const seedTimetable = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    // Resolve the demo grade → class exactly as seedDemo created them.
    const gradesAtOrder = await ctx.db
      .query("grades")
      .withIndex("by_order", (q) => q.eq("order", DEMO_GRADE_ORDER))
      .take(10);
    const grade = gradesAtOrder.find((g) => g.name === DEMO_GRADE_NAME);
    if (!grade) return 0;
    const classes = await ctx.db
      .query("classes")
      .withIndex("by_gradeId", (q) => q.eq("gradeId", grade._id))
      .take(20);
    const cls = classes.find((c) => c.name === DEMO_CLASS_NAME);
    if (!cls) return 0;

    // Demo subjects, in DEMO_SUBJECTS order for a deterministic rotation.
    const gradeSubjects = await ctx.db
      .query("subjects")
      .withIndex("by_gradeId", (q) => q.eq("gradeId", grade._id))
      .take(50);
    const subjects = DEMO_SUBJECTS.flatMap((name) => {
      const subject = gradeSubjects.find((s) => s.name === name);
      return subject ? [subject] : [];
    });
    if (subjects.length === 0) return 0;

    // The demo teacher's Better Auth user id, by email (as in seedDemo).
    const teacher: { _id: string; userId?: string | null } | null =
      await ctx.runQuery(components.betterAuth.adapter.findOne, {
        model: "user",
        where: [{ field: "email", value: DEMO_TEACHER_EMAIL }],
      });
    if (!teacher) return 0;
    const teacherId = teacher.userId ?? teacher._id;

    let created = 0;
    for (let weekday = 0; weekday <= 4; weekday++) {
      const daySlots = await ctx.db
        .query("timetableSlots")
        .withIndex("by_classId_and_weekday", (q) =>
          q.eq("classId", cls._id).eq("weekday", weekday),
        )
        .take(20);
      for (let period = 1; period <= 3; period++) {
        if (daySlots.some((slot) => slot.period === period)) continue;
        const subject = subjects[(weekday + period) % subjects.length];
        await ctx.db.insert("timetableSlots", {
          classId: cls._id,
          weekday,
          period,
          subjectId: subject._id,
          teacherId,
        });
        created++;
      }
    }
    return created;
  },
});

// ——— M4 demo question bank ———

type DemoQuestion = {
  type: "mcq" | "truefalse";
  text: string;
  options: Array<{ id: string; text: string }>;
  correctOptionId?: string;
  correctBool?: boolean;
  topic: string;
  difficulty: "easy" | "medium" | "hard";
};

const DEMO_QUESTIONS: Array<DemoQuestion> = [
  {
    type: "mcq",
    text: "كم عدد الصلوات المفروضة في اليوم والليلة؟",
    options: [
      { id: "a", text: "ثلاث صلوات" },
      { id: "b", text: "أربع صلوات" },
      { id: "c", text: "خمس صلوات" },
      { id: "d", text: "ست صلوات" },
    ],
    correctOptionId: "c",
    topic: "الصلاة",
    difficulty: "easy",
  },
  {
    type: "mcq",
    text: "كم عدد ركعات صلاة المغرب؟",
    options: [
      { id: "a", text: "ركعتان" },
      { id: "b", text: "ثلاث ركعات" },
      { id: "c", text: "أربع ركعات" },
      { id: "d", text: "خمس ركعات" },
    ],
    correctOptionId: "b",
    topic: "الصلاة",
    difficulty: "easy",
  },
  {
    type: "mcq",
    text: "أيٌّ مما يلي من نواقض الوضوء؟",
    options: [
      { id: "a", text: "الأكل والشرب" },
      { id: "b", text: "النوم العميق" },
      { id: "c", text: "المشي" },
      { id: "d", text: "الكلام" },
    ],
    correctOptionId: "b",
    topic: "الوضوء",
    difficulty: "medium",
  },
  {
    type: "mcq",
    text: "بأي ركن تبدأ الصلاة؟",
    options: [
      { id: "a", text: "تكبيرة الإحرام" },
      { id: "b", text: "قراءة الفاتحة" },
      { id: "c", text: "الركوع" },
      { id: "d", text: "السجود" },
    ],
    correctOptionId: "a",
    topic: "الصلاة",
    difficulty: "hard",
  },
  {
    type: "truefalse",
    text: "الوضوء شرط لصحة الصلاة.",
    options: [],
    correctBool: true,
    topic: "الوضوء",
    difficulty: "easy",
  },
  {
    type: "truefalse",
    text: "صلاة الفجر أربع ركعات.",
    options: [],
    correctBool: false,
    topic: "الصلاة",
    difficulty: "medium",
  },
];

/**
 * M4 demo question bank for the first demo subject (التربية الإسلامية),
 * owned by the demo teacher: 4 MCQ + 2 true/false in Arabic, mixed
 * difficulty. Idempotent — skipped when the subject already has ANY
 * question. Returns the number of questions created.
 *   npx convex run seed:seedQuestions '{}'
 */
export const seedQuestions = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    // Resolve the demo grade → first demo subject exactly as seedDemo
    // created them.
    const gradesAtOrder = await ctx.db
      .query("grades")
      .withIndex("by_order", (q) => q.eq("order", DEMO_GRADE_ORDER))
      .take(10);
    const grade = gradesAtOrder.find((g) => g.name === DEMO_GRADE_NAME);
    if (!grade) return 0;
    const gradeSubjects = await ctx.db
      .query("subjects")
      .withIndex("by_gradeId", (q) => q.eq("gradeId", grade._id))
      .take(50);
    const subject = gradeSubjects.find((s) => s.name === DEMO_SUBJECTS[0]);
    if (!subject) return 0;

    // Idempotent: the demo subject already has a question bank.
    const existing = await ctx.db
      .query("questions")
      .withIndex("by_subjectId", (q) => q.eq("subjectId", subject._id))
      .first();
    if (existing) return 0;

    // The demo teacher's Better Auth user id, by email (as in seedDemo).
    const teacher: { _id: string; userId?: string | null } | null =
      await ctx.runQuery(components.betterAuth.adapter.findOne, {
        model: "user",
        where: [{ field: "email", value: DEMO_TEACHER_EMAIL }],
      });
    if (!teacher) return 0;
    const teacherId = teacher.userId ?? teacher._id;

    let created = 0;
    for (const question of DEMO_QUESTIONS) {
      await ctx.db.insert("questions", {
        teacherId,
        subjectId: subject._id,
        type: question.type,
        text: question.text,
        options: question.options,
        correctOptionId: question.correctOptionId,
        correctBool: question.correctBool,
        topic: question.topic,
        difficulty: question.difficulty,
        archived: false,
      });
      created++;
    }
    return created;
  },
});

// ——— M5 welcome announcement ———

const WELCOME_TITLE = "أهلًا بكم في المنصة";
const WELCOME_BODY =
  "يسعدنا انضمامكم إلى منصة المدرسة. من هنا تتابعون جدول الحصص ونتائج " +
  "الاختبارات وسجلّ الحضور، وتصلكم ملاحظات المعلّمين وإعلانات المدرسة " +
  "أولًا بأول.";

/**
 * M5 demo announcement: one school-scope welcome post authored by the
 * system, fanned out as a notification to every active student. Idempotent —
 * skipped when a school announcement with the same title already exists.
 * Returns whether it was created.
 *   npx convex run seed:seedAnnouncement '{}'
 */
export const seedAnnouncement = internalMutation({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    const school = await ctx.db
      .query("announcements")
      .withIndex("by_scope", (q) => q.eq("scope", "school"))
      .take(100);
    if (school.some((announcement) => announcement.title === WELCOME_TITLE)) {
      return false;
    }
    await ctx.db.insert("announcements", {
      scope: "school",
      title: WELCOME_TITLE,
      body: WELCOME_BODY,
      authorId: "system",
      authorName: "إدارة المدرسة",
    });
    await notifyAllActiveStudents(ctx, {
      type: "announcement",
      title: WELCOME_TITLE,
      body: WELCOME_BODY.slice(0, 100),
      refType: "announcement",
    });
    return true;
  },
});

/**
 * Dev/CLI-only helper (internal — unreachable from clients): issue a code for
 * a student through the SAME core path as api.codes.issueCode, without a
 * staff session. Lets local smoke tests exercise the student login flow.
 *   npx convex run seed:devIssueCode '{"studentId":"..."}'
 */
export const devIssueCode = internalMutation({
  args: { studentId: v.id("students") },
  returns: v.object({ code: v.string() }),
  handler: async (ctx, args) => {
    const code = await issueCodeCore(ctx, args.studentId, "system", {
      actorType: "system",
      actorId: "system",
    });
    return { code };
  },
});
