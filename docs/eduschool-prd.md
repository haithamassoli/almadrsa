# E-School Platform — PRD

A PWA that runs one full-time private school: Admin manages the academic structure, teachers run timetables, attendance, exams, homework, and grading; each student+parent pair sees everything through a single passwordless, code-based account. Arabic-first (RTL), real-time, installable on mobile with push notifications. Single-tenant now; schema must not block a future multi-school SaaS (adding a `schoolId` later must not be a rewrite — no tenancy UI or logic in v1).

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js (App Router, RSC) |
| Backend / DB / realtime | Convex (live queries everywhere data is displayed) |
| Staff auth | Convex Auth (email + password) |
| Student/parent auth | Custom code-based (below) |
| Styling | Tailwind CSS, full RTL, dark mode |
| PWA | Service worker (offline shell) + manifest + Web Push |
| Files | Convex file storage (photos, audio, images in questions) |

## Roles

- **Admin**: manages accounts (create/edit/disable/delete staff and students), academic structure, teacher↔class/subject assignments, grade weights, global settings, broadcasts; sees school-wide analytics and the audit log.
- **Teacher**: manages own classes — students (incl. CSV bulk import), lessons, attendance, exams, homework, grading, notes, question bank (own subjects), library resources, class announcements, messaging parents.
- **Student/Parent** (one shared account per student): views attendance, results, notes, analytics, class-average comparison, calendar, library, gamification; submits homework and takes exams; receives notifications.

Every Convex function checks role and ownership server-side. Client-side checks are cosmetic only.

## Auth

- **Staff**: email + password, role-based access.
- **Student/parent**: login with a single code — cryptographically random, ≥128 bits entropy, non-sequential. Admin/teacher can regenerate or revoke instantly. Rate-limit code attempts (per IP and global). Optional PIN on first login from a new device with "remember this device". Every code login is written to the audit log.
- One code per child; a parent with N children uses N codes (no parent grouping in v1).
- Identity caveat (accepted): the shared code cannot prove whether parent or student acted. Exam integrity is deterrence, not prevention.

## Modules

### Academic structure
Grades → Subjects → Classes/Sections → Terms. Students enroll in classes; teachers are assigned to (subject, class) pairs. Per-subject grade weights (exams/homework/participation %) configured by Admin.

### Timetable & lessons
Weekly recurring timetable per class (weekday, period, subject, teacher). Lessons are dated instances (auto from timetable or ad-hoc) and can carry resources. Attendance attaches to a lesson instance.

### Attendance
Present / absent / late per lesson. QR check-in option (Phase 2). History feeds analytics, report cards, and parent notifications.

### Assessments
Question types: MCQ, True/False, Fill-in-blank, Matching, Ordering (all auto-graded); Essay (manual); any question may include an image.
- Exams: pick questions directly or from the bank; start/end window, per-exam time limit, auto-close and auto-submit at window end.
- Auto-graded parts return instant results; essays enter a manual grading queue with optional rubric and text or voice feedback.
- Attempts autosave continuously (locally + server); a dropped connection resumes where the student left off.

### Homework
Assignments per class with deadline; submission auto-closes at deadline. Submission = text + photos/files + voice recording (in-browser MediaRecorder). Reminder notification before deadline. Teacher grades/marks with feedback.

### Question bank
Reusable questions tagged subject / topic / difficulty. Topic tag optional but required for weak-point analytics (untagged questions are excluded from it, not blocked).

### Report cards (added — full-time school requirement)
Per student, per term: subject grades computed from the configured weights, attendance summary, teacher remarks. Exportable as PDF. Admin publishes; parents see published cards only.

### Gamification
Points (homework submitted, exam score thresholds, attendance, streaks — point values Admin-configurable), levels from cumulative points, badges for milestones, streaks, class and school leaderboards (live).

### Analytics
Role-scoped, real-time: student/class/subject performance charts, trends over time, student vs class average, attendance patterns, weak-point detection (most-missed topics + review recommendation). Admin sees school-wide; teacher sees own classes; parent sees own child.

### Communication
Announcements with scope: school-wide (Admin) or class (teacher). Two-way teacher↔parent messaging (Phase 3). Architecture keeps a notification-channel abstraction so WhatsApp/SMS can be added without touching triggers.

### Digital library
Teacher adds title + link, attached to subject/class.

### Calendar
Lessons, exam windows, homework deadlines, holidays, events; filterable by role/class.

### Notifications
In-app notification center is the source of truth; Web Push is best-effort (iOS delivers only after PWA install). Triggers: new exam/homework, deadline approaching, results published, new note/feedback, absence, announcement.

## Exam integrity (deterrence, not prevention)

- Shuffle question and option order per student (seeded at attempt creation).
- Generate unique exam versions per student from the bank.
- Log tab-switch / focus-loss events on the attempt; show count to teacher.
- Optional "no returning to previous question" mode.

## Data model (suggested, non-binding)

`users` (staff: admin | teacher) · `students` · `accessCodes` (code hash, studentId, status, rememberedDevices) · `grades` `subjects` `classes` `terms` · `enrollments` · `timetableSlots` · `lessons` · `attendance` · `questions` · `exams` · `examAttempts` (shuffle seed, answers, autoScore, manualScore, focusLossEvents) · `homework` · `homeworkSubmissions` (text, fileIds, audioId) · `notes` (text | audioId) · `gradeWeights` · `reportCards` · `gamification` (+ point events) · `announcements` · `messages` · `libraryResources` · `notifications` · `pushSubscriptions` · `auditLog`

## Non-functional

- Arabic RTL first-class; all strings through an i18n layer from day one (Arabic is the only shipped locale). Gregorian dates.
- Mobile-first, responsive, dark mode, fast on poor mobile networks.
- Offline: service worker caches the app shell; exam/homework autosave survives disconnects. No full offline sync.
- Uploads capped (photos ≤ 10 MB, voice ≤ 5 min).
- Audit log for sensitive ops (logins, code regeneration, grade changes, deletions).
- Convex automatic backups enabled.
- Minors' data: least-privilege access enforced in every server function, rate limiting, access logging.

## Out of scope (v1)

Fees/billing (flagged gap for a private school — revisit), parent account grouping multiple children, WhatsApp/SMS (channel abstraction only), Hijri calendar, native apps, full offline mode, proctoring-grade anti-cheat, locales beyond Arabic.

## Phases

**Phase 1 — run the school day.** Staff + code auth (rate limiting, revoke/regenerate, logging). Academic structure, terms, CSV student import. Timetable + lessons. Manual attendance + parent view. Exam engine v1: MCQ + True/False, window + timer + auto-close, instant grading, basic question bank. Portal: results, attendance history, teacher notes (text), class-average comparison. Announcements (school + class scope). Points + streaks. In-app notification center. Audit log.

**Phase 2 — full teaching workload.** Remaining question types + manual essay grading (rubrics, text/voice feedback). Homework module (text/photo/voice, deadline auto-close, reminders). Question/option shuffling. QR attendance. Badges, levels, leaderboards. Analytics dashboard (weak points, trends, attendance patterns). Report cards + PDF. PWA install + Web Push.

**Phase 3 — ecosystem & integrity.** Two-way messaging. Digital library. Interactive calendar. Unique exam versions, focus-loss logging, no-backtrack mode. Exportable reports. WhatsApp/SMS channel.
