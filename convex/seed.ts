import { v } from "convex/values";
import { internalAction, internalMutation } from "./_generated/server";
import { components, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { createAuth } from "./auth";
import { mintQrToken } from "./checkin";
import { issueCodeCore } from "./codes";
import { createHomeworkCore } from "./homework";
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

// Reset a staff member's password from the CLI. Staff have no email/reset
// flow (public signup is disabled), so this is the only recovery path. Uses
// the same trusted internal-adapter path as Better Auth's admin
// setUserPassword, minus its admin-session requirement.
//   npx convex run seed:resetStaffPassword '{"email":"...","password":"..."}' --prod
export const resetStaffPassword = internalAction({
  args: { email: v.string(), password: v.string() },
  returns: v.object({ userId: v.string() }),
  handler: async (ctx, args) => {
    const auth = createAuth(ctx);
    const authCtx = await auth.$context;
    const user: { _id: string; userId?: string | null } | null =
      await ctx.runQuery(components.betterAuth.adapter.findOne, {
        model: "user",
        where: [{ field: "email", value: args.email }],
      });
    if (!user) throw new Error(`No staff account for ${args.email}`);
    const userId = user.userId ?? user._id;
    const hashed = await authCtx.password.hash(args.password);
    const accounts = await authCtx.internalAdapter.findAccounts(userId);
    if (accounts.some((account) => account.providerId === "credential")) {
      await authCtx.internalAdapter.updatePassword(userId, hashed);
    } else {
      await authCtx.internalAdapter.createAccount({
        userId,
        providerId: "credential",
        accountId: userId,
        password: hashed,
      });
    }
    return { userId };
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
const DEMO_TEACHER_EMAIL = "teacher@almdrasa.dev";
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
    // Only claim "active" if nothing else already holds it — the app enforces
    // exactly one active term (see academics.setActiveTerm).
    const existingActiveTerm = await ctx.db
      .query("terms")
      .withIndex("by_active", (q) => q.eq("active", true))
      .first();
    await ctx.db.insert("terms", {
      name: DEMO_TERM_NAME,
      startDate: Date.UTC(2026, 8, 1), // 2026-09-01
      endDate: Date.UTC(2027, 0, 31), // 2027-01-31
      active: existingActiveTerm === null,
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

// ——— M8 demo question bank v2 (new types) ———

type DemoQuestionV2 = {
  type: "fillblank" | "matching" | "ordering" | "essay";
  text: string;
  blanks?: Array<{ id: string; acceptedAnswers: Array<string> }>;
  pairs?: Array<{ id: string; left: string; right: string }>;
  items?: Array<{ id: string; text: string }>;
  rubricText?: string;
  topic: string;
  difficulty: "easy" | "medium" | "hard";
};

const DEMO_QUESTIONS_V2: Array<DemoQuestionV2> = [
  {
    type: "fillblank",
    // Two "____" placeholders ↔ two blanks, in order.
    text: "الصلوات المفروضة في اليوم والليلة عددها ____ صلوات، وأولها صلاة ____.",
    blanks: [
      { id: "b1", acceptedAnswers: ["خمس", "خمسة", "5", "٥"] },
      { id: "b2", acceptedAnswers: ["الفجر", "الصبح"] },
    ],
    topic: "الصلاة",
    difficulty: "easy",
  },
  {
    type: "matching",
    text: "صِل كل صلاة بعدد ركعاتها الصحيح.",
    pairs: [
      { id: "p1", left: "صلاة الفجر", right: "ركعتان" },
      { id: "p2", left: "صلاة المغرب", right: "ثلاث ركعات" },
      { id: "p3", left: "صلاة العشاء", right: "أربع ركعات" },
    ],
    topic: "الصلاة",
    difficulty: "medium",
  },
  {
    type: "ordering",
    text: "رتّب أركان الوضوء بالترتيب الصحيح.",
    // Doc order IS the correct order.
    items: [
      { id: "i1", text: "غسل الوجه" },
      { id: "i2", text: "غسل اليدين إلى المرفقين" },
      { id: "i3", text: "مسح الرأس" },
      { id: "i4", text: "غسل الرجلين إلى الكعبين" },
    ],
    topic: "الوضوء",
    difficulty: "medium",
  },
  {
    type: "essay",
    text: "اكتب ثلاثة أسطر عن أهمية الصلاة في حياة المسلم.",
    rubricText:
      "معايير التقييم: ذكر مكانة الصلاة في الإسلام (درجتان)، أثرها في سلوك " +
      "المسلم وحياته اليومية (درجتان)، سلامة اللغة ووضوح التعبير (درجة).",
    topic: "الصلاة",
    difficulty: "hard",
  },
];

/**
 * M8 demo bank v2 for the first demo subject (التربية الإسلامية), owned by
 * the demo teacher: one question of each new type in Arabic — fillblank
 * (2 blanks), matching (3 pairs), ordering (4 items, أركان الوضوء
 * بالترتيب) and essay (with a rubric). Idempotent — skipped when the
 * subject already has ANY question of a v2 type. Returns the number of
 * questions created.
 *   npx convex run seed:seedQuestionsV2 '{}'
 */
export const seedQuestionsV2 = internalMutation({
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

    // Idempotent: any v2-type question in the subject means we already ran.
    const v2Types = new Set(["fillblank", "matching", "ordering", "essay"]);
    const existing = await ctx.db
      .query("questions")
      .withIndex("by_subjectId", (q) => q.eq("subjectId", subject._id))
      .take(500);
    if (existing.some((question) => v2Types.has(question.type))) return 0;

    // The demo teacher's Better Auth user id, by email (as in seedDemo).
    const teacher: { _id: string; userId?: string | null } | null =
      await ctx.runQuery(components.betterAuth.adapter.findOne, {
        model: "user",
        where: [{ field: "email", value: DEMO_TEACHER_EMAIL }],
      });
    if (!teacher) return 0;
    const teacherId = teacher.userId ?? teacher._id;

    let created = 0;
    for (const question of DEMO_QUESTIONS_V2) {
      await ctx.db.insert("questions", {
        teacherId,
        subjectId: subject._id,
        type: question.type,
        text: question.text,
        options: [],
        blanks: question.blanks,
        pairs: question.pairs,
        items: question.items,
        rubricText: question.rubricText,
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

// ——— M9 demo homework ———

const DEMO_HOMEWORK_TITLE = "واجب: حفظ سورة الفاتحة";
const DEMO_HOMEWORK_DESCRIPTION =
  "احفظ سورة الفاتحة مع مراعاة أحكام التجويد، ثم سجّل تلاوتك صوتيًا أو " +
  "اكتب الآيات كتابةً وأرفقها هنا قبل الموعد النهائي.";

/**
 * M9 demo homework: one OPEN homework for the demo class on the first demo
 * subject (التربية الإسلامية), due in 3 days, out of 10 — created through
 * createHomeworkCore, i.e. EXACTLY like homework.create: the auto-close and
 * reminder functions are scheduled and the class notification fans out.
 * Idempotent — skipped when the class already has a homework with the demo
 * title. Returns whether it was created.
 *   npx convex run seed:seedHomework '{}'
 */
export const seedHomework = internalMutation({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    // Resolve the demo grade → class → first subject exactly as seedDemo
    // created them.
    const gradesAtOrder = await ctx.db
      .query("grades")
      .withIndex("by_order", (q) => q.eq("order", DEMO_GRADE_ORDER))
      .take(10);
    const grade = gradesAtOrder.find((g) => g.name === DEMO_GRADE_NAME);
    if (!grade) return false;
    const classes = await ctx.db
      .query("classes")
      .withIndex("by_gradeId", (q) => q.eq("gradeId", grade._id))
      .take(20);
    const cls = classes.find((c) => c.name === DEMO_CLASS_NAME);
    if (!cls) return false;
    const gradeSubjects = await ctx.db
      .query("subjects")
      .withIndex("by_gradeId", (q) => q.eq("gradeId", grade._id))
      .take(50);
    const subject = gradeSubjects.find((s) => s.name === DEMO_SUBJECTS[0]);
    if (!subject) return false;

    // Idempotent: the demo class already has the seeded homework.
    const existing = await ctx.db
      .query("homework")
      .withIndex("by_classId", (q) => q.eq("classId", cls._id))
      .take(200);
    if (existing.some((homework) => homework.title === DEMO_HOMEWORK_TITLE)) {
      return false;
    }

    // The demo teacher's Better Auth user id, by email (as in seedDemo).
    const teacher: { _id: string; userId?: string | null } | null =
      await ctx.runQuery(components.betterAuth.adapter.findOne, {
        model: "user",
        where: [{ field: "email", value: DEMO_TEACHER_EMAIL }],
      });
    if (!teacher) return false;
    const teacherId = teacher.userId ?? teacher._id;

    await createHomeworkCore(ctx, {
      teacherId,
      classId: cls._id,
      subjectId: subject._id,
      title: DEMO_HOMEWORK_TITLE,
      description: DEMO_HOMEWORK_DESCRIPTION,
      deadline: Date.now() + 3 * 24 * 60 * 60 * 1000,
      marks: 10,
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

/**
 * M7 E2E bootstrap (internal — unreachable from clients): idempotently
 * ensures the demo dataset exists (seedDemo + seedTimetable + seedQuestions,
 * each already a no-op when its data is present), then issues a FRESH access
 * code for the demo student «أحمد الخطيب» (or the first active enrolled
 * student of the demo class) through the SAME core path as api.codes.issueCode.
 * Regenerating on every call is fine — issueCodeCore revokes the previous
 * active code and purges its sessions/devices, exactly like a staff reissue.
 *   npx convex run seed:e2eBootstrap '{}'
 */
export const e2eBootstrap = internalMutation({
  args: {},
  returns: v.object({ code: v.string(), studentName: v.string() }),
  handler: async (ctx): Promise<{ code: string; studentName: string }> => {
    await ctx.runMutation(internal.seed.seedDemo, {});
    await ctx.runMutation(internal.seed.seedTimetable, {});
    await ctx.runMutation(internal.seed.seedQuestions, {});

    // Resolve demo grade → class exactly as the seeds created them.
    const gradesAtOrder = await ctx.db
      .query("grades")
      .withIndex("by_order", (q) => q.eq("order", DEMO_GRADE_ORDER))
      .take(10);
    const grade = gradesAtOrder.find((g) => g.name === DEMO_GRADE_NAME);
    if (!grade) throw new Error("Demo grade missing after seeding");
    const classes = await ctx.db
      .query("classes")
      .withIndex("by_gradeId", (q) => q.eq("gradeId", grade._id))
      .take(20);
    const cls = classes.find((c) => c.name === DEMO_CLASS_NAME);
    if (!cls) throw new Error("Demo class missing after seeding");

    // Prefer the canonical demo student; fall back to the first active
    // enrolled student of the class.
    const enrollments = await ctx.db
      .query("enrollments")
      .withIndex("by_classId_and_active", (q) =>
        q.eq("classId", cls._id).eq("active", true),
      )
      .take(200);
    const activeStudents: Array<Doc<"students">> = [];
    for (const enrollment of enrollments) {
      const enrolled = await ctx.db.get("students", enrollment.studentId);
      if (enrolled && enrolled.status === "active") {
        activeStudents.push(enrolled);
      }
    }
    const student =
      activeStudents.find(
        (s) =>
          s.firstName === DEMO_STUDENTS[0].firstName &&
          s.lastName === DEMO_STUDENTS[0].lastName,
      ) ?? activeStudents[0];
    if (!student) {
      throw new Error("No active enrolled student in the demo class");
    }

    const code = await issueCodeCore(ctx, student._id, "system", {
      actorType: "system",
      actorId: "system",
    });
    return { code, studentName: `${student.firstName} ${student.lastName}` };
  },
});

/**
 * M16 E2E bootstrap sibling (internal — unreachable from clients): same as
 * e2eBootstrap, but issues a FRESH access code for a DIFFERENT active enrolled
 * student of the demo class, so the family-switch spec can log two children in
 * on one device. Resolves the same class/active-student set as e2eBootstrap,
 * identifies the student e2eBootstrap would pick, then picks the first active
 * student whose id differs — the two bootstraps always yield distinct students.
 *   npx convex run seed:e2eBootstrapSibling '{}'
 */
export const e2eBootstrapSibling = internalMutation({
  args: {},
  returns: v.object({ code: v.string(), studentName: v.string() }),
  handler: async (ctx): Promise<{ code: string; studentName: string }> => {
    await ctx.runMutation(internal.seed.seedDemo, {});
    await ctx.runMutation(internal.seed.seedTimetable, {});
    await ctx.runMutation(internal.seed.seedQuestions, {});

    // Resolve demo grade → class exactly as the seeds created them.
    const gradesAtOrder = await ctx.db
      .query("grades")
      .withIndex("by_order", (q) => q.eq("order", DEMO_GRADE_ORDER))
      .take(10);
    const grade = gradesAtOrder.find((g) => g.name === DEMO_GRADE_NAME);
    if (!grade) throw new Error("Demo grade missing after seeding");
    const classes = await ctx.db
      .query("classes")
      .withIndex("by_gradeId", (q) => q.eq("gradeId", grade._id))
      .take(20);
    const cls = classes.find((c) => c.name === DEMO_CLASS_NAME);
    if (!cls) throw new Error("Demo class missing after seeding");

    const enrollments = await ctx.db
      .query("enrollments")
      .withIndex("by_classId_and_active", (q) =>
        q.eq("classId", cls._id).eq("active", true),
      )
      .take(200);
    const activeStudents: Array<Doc<"students">> = [];
    for (const enrollment of enrollments) {
      const enrolled = await ctx.db.get("students", enrollment.studentId);
      if (enrolled && enrolled.status === "active") {
        activeStudents.push(enrolled);
      }
    }

    // Identify the student e2eBootstrap resolves to (canonical demo student, or
    // the first active one), then pick the first active student that differs.
    const primary =
      activeStudents.find(
        (s) =>
          s.firstName === DEMO_STUDENTS[0].firstName &&
          s.lastName === DEMO_STUDENTS[0].lastName,
      ) ?? activeStudents[0];
    const sibling = activeStudents.find((s) => s._id !== primary?._id);
    if (!sibling) {
      throw new Error(
        "Demo class needs at least 2 active enrolled students for the sibling bootstrap",
      );
    }

    const code = await issueCodeCore(ctx, sibling._id, "system", {
      actorType: "system",
      actorId: "system",
    });
    return { code, studentName: `${sibling.firstName} ${sibling.lastName}` };
  },
});

// ——— M11 demo term (report cards need a term covering the demo data) ———

const CURRENT_TERM_NAME = "الفصل التجريبي الحالي";

/**
 * M11 dev helper (internal — unreachable from clients): ensure a term whose
 * window COVERS TODAY (±60 days) exists, so report cards computed over the
 * demo exams/homework/attendance — all dated around "now" — come out
 * non-empty. The seeded academic terms start months away, which would make
 * every generated card blank. Created INACTIVE (activation stays with
 * academics.setActiveTerm and its single-active invariant). Idempotent by
 * name; returns the term id either way.
 *   npx convex run seed:seedCurrentTerm '{}'
 */
export const seedCurrentTerm = internalMutation({
  args: {},
  returns: v.id("terms"),
  handler: async (ctx) => {
    const terms = await ctx.db.query("terms").take(100);
    const existing = terms.find((term) => term.name === CURRENT_TERM_NAME);
    if (existing) return existing._id;
    const now = Date.now();
    const sixtyDays = 60 * 24 * 60 * 60 * 1000;
    return await ctx.db.insert("terms", {
      name: CURRENT_TERM_NAME,
      startDate: now - sixtyDays,
      endDate: now + sixtyDays,
      active: false,
    });
  },
});

/**
 * M11 dev helper (internal — unreachable from clients): mint a QR check-in
 * token for a lesson through the SAME core as checkin.issueToken, without a
 * staff session. Lets local smoke tests exercise the student checkIn flow.
 *   npx convex run seed:devQrToken '{"lessonId":"..."}'
 */
export const devQrToken = internalMutation({
  args: { lessonId: v.id("lessons") },
  returns: v.string(),
  handler: async (ctx, args) => {
    const lesson = await ctx.db.get("lessons", args.lessonId);
    if (!lesson) throw new Error("Lesson not found");
    return await mintQrToken(ctx, args.lessonId);
  },
});
