# Pilot runbook — Day-0 onboarding for one real class

Operational checklist for taking **one real class** live on almadrsa. Do the
steps top to bottom: each one depends on the data created before it. Prod must
already be deployed with backups on (see `docs/deploy.md` → Production
checklist).

UI is Arabic (RTL). Page names below are the exact sidebar labels; the Arabic
label is given with the route so whoever is driving the screen can find it.

Roles used here:

- **Admin** — sets up structure, staff, students, codes, timetable.
- **Teacher** — runs the daily flow (attendance, exams).
- **Student/parent** — one shared code-based account per child; portal only.

---

## 0. Preconditions

- Production URL loads; a staff (admin) account exists and can sign in
  (`/login` → تسجيل الدخول).
- Convex prod automatic backups are enabled (daily). Do not enter real student
  data until this is confirmed.
- You have the class roster ready (first name, last name, guardian name,
  guardian phone) and a printer for the access codes.

---

## 1. Build the academic structure

Admin → **الهيكل الأكاديمي** (`/admin/structure`). This page has tabs; do them
in this order because each depends on the previous:

1. **الصفوف** (Grades) — add the grade the pilot class belongs to (e.g. "الصف
   السابع"). Set its ترتيب (order) for sorting.
2. **المواد** (Subjects) — select the grade, then add each subject the class
   studies (e.g. رياضيات، لغة عربية، علوم). Subjects belong to a grade.
3. **الشُعب** (Classes/sections) — select the grade, then add the one pilot
   section (e.g. "٧/أ"). This is the *class* students enrol in.
4. **الفصول الدراسية** (Terms) — add the current term with a start and end date,
   then **تعيين كنشط** (Set active). Exactly one active term drives the school
   day. End date must be after start date.
5. **إسناد المعلمين** (Teacher assignments) — do this *after* step 2 in the next
   section (you need the teacher account first). Select the شعبة, then assign a
   معلّم to each مادة. A teacher can only run attendance/exams for a
   (subject, class) pair they are assigned to.

Optional but recommended before exams matter: Admin → **أوزان الدرجات**
(`/admin/weights`) to set per-subject exam/homework/participation weights.

---

## 2. Create the teacher account

Admin → **الطاقم** (`/admin/staff`) → **إضافة عضو**.

- Fill الاسم الكامل, البريد الإلكتروني, الدور = معلّم (teacher).
- Use **توليد كلمة مرور** to generate a password. **The password is shown
  once** — copy it (**نسخ كلمة المرور**) and hand it to the teacher over a
  secure channel before closing the dialog. There is no recovery; if lost,
  create a new one or reset.
- Staff cannot self-register — every account is admin-created.

Now go back to **الهيكل الأكاديمي → إسناد المعلمين** and assign this teacher to
each subject of the pilot class (step 1.5 above).

---

## 3. Add students (CSV bulk import)

Admin → **الطلاب** (`/admin/students`) → **استيراد CSV**.

CSV format — the parser (`app/admin/students/csv.ts`) accepts these column
headers, Latin or Arabic, in any order:

| Latin header    | Arabic header | Required | Notes |
|-----------------|---------------|----------|-------|
| `firstName`     | `الاسم الأول`   | **Yes**  | |
| `lastName`      | `اسم العائلة`   | **Yes**  | |
| `guardianName`  | `ولي الأمر`     | No       | |
| `guardianPhone` | `الهاتف`        | No       | |
| `className`     | `الشعبة`        | No       | Must match an existing section name; if the same section name exists under more than one grade the row is rejected (اسم الشعبة مكرر) — leave it blank and enrol manually, or rename. |

Rules:

- `firstName` and `lastName` columns are mandatory or the file is rejected
  (ترويسة الملف غير صحيحة).
- UTF-8; a BOM and quoted fields (commas/newlines inside quotes) are handled.
- Max **500** rows per import.
- The dialog previews the first rows and shows a per-row result:
  **{ok} نجح · {fail} فشل**, with a "صفوف لم تُستورد" list for failures — fix
  those rows and re-import just them.

Prefer putting `className` (`الشعبة`) in the CSV so students land enrolled in the
pilot section directly. Otherwise add students without a class and set the شعبة
per student via **تعديل بيانات الطالب**.

You can also add students one at a time with **إضافة طالب**.

---

## 4. Issue and print access codes

Admin → **رموز الدخول** (`/admin/codes`).

1. Choose the grade (اختر صفًا…) to list its students.
2. Bulk-issue: **إصدار للجميع** (issue for everyone) or **إصدار للناقص فقط**
   (only students without an active code). Confirm the dialog — issuing a new
   code **instantly kills the old one and ends all its sessions**.
3. Codes are shown **once only** (يظهر هذا الرمز مرة واحدة فقط) — they are stored
   hashed and cannot be recovered. The print sheet (**ورقة رموز الدخول**) opens
   with one ticket per student and dedicated print styles (`Ctrl/Cmd+P`). Each
   ticket carries the student name, code, and the "ادخل عبر صفحة دخول الطالب"
   instruction.
4. Print immediately, then close the sheet (**إغلاق الورقة**) — once you leave
   the page the plaintext codes are gone for good. Distribute tickets to
   guardians.
5. Single students: **إصدار** / **إعادة إصدار** / **إلغاء** per row. Use إلغاء
   to revoke a lost code (ends sessions immediately).

Students/parents sign in at `/code` (صفحة دخول الطالب) with the code; an optional
PIN can be set on first login from a new device with "remember this device".

---

## 5. Build the weekly timetable

Admin → **الجدول الدراسي** (`/admin/timetable`).

- Pick the الفصل (class/section).
- For each weekday column (الأحد–الخميس, Sunday–Thursday) and each حصة (period),
  **إضافة حصة**: choose the المادة and المعلّم. The teacher must be assigned to
  that subject in this class, and a teacher can't be double-booked in the same
  period (المعلّم لديه حصة أخرى في هذا الوقت).
- If "لا توجد فصول بعد" shows, structure isn't built yet — go back to step 1.

Lessons are dated instances generated from this timetable; the teacher marks
attendance against them.

---

## 6. Teacher daily flow

Teacher signs in (`/login`) → **الرئيسية** (`/teacher`, teacher home).

- Home lists **today's lessons** from the timetable, each with an attendance
  progress badge (الحضور {marked}/{enrolled}).
- Open a lesson (**فتح الحصة …**, `/teacher/lessons/[lessonId]`).
- In **تسجيل الحضور**: set each student حاضر / متأخر / غائب, or **تحديد الجميع
  حاضرًا** then adjust exceptions, then **حفظ الحضور**. Attendance is editable
  after the fact.
- Optional per-lesson: **المصادر** (resource links, https only) and **ملاحظات
  الحصة** (lesson notes).
- Off-schedule session? **حصة إضافية** creates an ad-hoc lesson.

Attendance history for review: Teacher → **الحضور** (`/teacher/attendance`),
by class or by student, with date range and present/late/absent totals.

---

## 7. Publish the first exam

Teacher → **بنك الأسئلة** (`/teacher/questions`) → add MCQ / صح أو خطأ questions
tagged to the subject (and optionally topic/difficulty).

Then Teacher → **الاختبارات** (`/teacher/exams`) → **إنشاء اختبار**:

1. Set عنوان الاختبار, الفصل, المادة.
2. Set the window (**بداية النافذة** / **نهاية النافذة**) and **مدة المحاولة**
   (per-attempt time limit, minutes). Start must be before end; the window can't
   already be in the past at publish time.
3. Pick questions from the subject bank and assign marks per question (each > 0,
   ≤ 100). **حفظ كمسودة**.
4. On the exam page, **نشر الاختبار** and confirm. After publishing the exam is
   visible to students and **can no longer be edited**. It auto-closes at the
   window end (open attempts auto-submit); **إغلاق الآن** closes early.
5. Grading is instant on submit. Results: exam → **النتائج**, with submitted
   count, avg/max/min, and per-student scores. **تعديل الدرجة** overrides a score
   (audit-logged).

---

## 8. What parents/students see in the portal

Student/parent sign in at `/code`, land on **الرئيسية** (`/portal`):

- **حصص اليوم** — today's lessons with attendance status
  (حاضر/متأخر/غائب/لم يُسجَّل بعد).
- **آخر النتائج** — recent exam scores; each result opens a **مقارنة بالفصل**
  view (درجتك / متوسط الفصل / أعلى درجة).
- **الحضور (آخر 30 يومًا)** — attendance rate; **عرض السجل كاملًا**
  (`/portal/attendance`) for full history with date range.
- **ملاحظات المعلّمين** — teacher notes on the student.
- **الإعلانات** (`/portal/announcements`) — school-wide and class announcements.
- **الإشعارات** (`/portal/notifications`) — notification center with unread
  badge; triggers fire on new exam, results published, absence, new note, new
  announcement. **تحديد الكل مقروءًا** to clear.
- **الاختبارات** (`/portal/exams`) — published exams; take within the window,
  autosaves and resumes after a disconnect, instant result on submit.

Confirm end-to-end once on a real phone: teacher marks an absence → parent sees
it and gets a notification; publish a short exam → student takes it → both see
the result.

---

## 9. Feedback collection & triage

Collect pilot feedback in a shared sheet using this template. One row per issue.

| Date | Role (admin/teacher/parent/student) | Page (Arabic label + route) | Issue / expected vs actual | Severity (blocker / major / minor / cosmetic) | Status |
|------|-------------------------------------|-----------------------------|----------------------------|-----------------------------------------------|--------|
|      |                                     |                             |                            |                                               | open   |

Severity guide:

- **blocker** — can't complete a core task (login, attendance, take exam,
  see results). Fix same day.
- **major** — wrong data or a broken flow with a workaround.
- **minor** — friction, confusing copy, layout niggle.
- **cosmetic** — polish.

Triage cadence:

- **Week 1: daily.** End-of-day review of new rows with the teacher and one
  parent. Every blocker gets a same-day owner; majors scheduled within 48h.
- **Week 2+:** twice weekly, then weekly once the flow is stable.
- Keep a short "known issues / workarounds" note the teacher can reference so the
  same thing isn't reported repeatedly.

Escalation: any data-integrity or access-control issue (a student seeing another
student's data, a code that won't die on revoke) is an automatic blocker —
revoke affected codes immediately and fix before continuing the pilot.
