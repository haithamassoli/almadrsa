# E-School Platform — Milestones & Tasks

Source: [eduschool-prd.md](./eduschool-prd.md). Milestones are dependency-ordered; each ends in something demoable. Cross-cutting concerns (audit log, notification triggers, gamification hooks) land as tasks inside the feature milestone that produces them.

## Phase 1 — run the school day

### M0 — Scaffold
Ships: empty app, deployed, with the conventions every later milestone inherits.

- [x] Next.js (App Router) + Convex wired; one live query round-trips
- [x] Tailwind with RTL (dir="rtl", logical properties), dark mode, base app shell/layout
- [x] i18n layer; all UI strings in an Arabic locale file (only shipped locale)
- [x] Convex schema stub with core tables + shared validators
- [x] Deploy pipeline: Vercel previews, Convex dev/prod environments (Vercel account link = manual step, see docs/deploy.md)

### M1 — Auth & access control
Ships: staff log in with email/password, a student/parent logs in with a code; every server function has role guards to build on.

- [x] Better Auth email+password for staff; `role: admin | teacher` (local-install; supersedes the PRD's "Convex Auth")
- [x] Server auth helpers (`requireAdmin`, `requireTeacher`, `requireStudentAccount`) — mandatory in every function from here on
- [x] Access codes: ≥128-bit crypto-random, hash-only storage, active/revoked status
- [x] Code login flow; admin/teacher regenerate + revoke instantly
- [x] Rate limiting on code attempts (per-IP + global)
- [x] Optional PIN on first login from new device + "remember this device"
- [x] `auditLog` table + helper; log every code login and code regeneration
- [x] Login screens (staff, code entry), Arabic RTL, mobile-first

### M2 — Academic structure & people
Ships: admin sets up the whole school; every student has a code.

- [x] CRUD: grades, subjects, classes/sections, terms (admin UI)
- [x] Teacher ↔ (subject, class) assignments
- [x] Students CRUD + class enrollment
- [x] CSV bulk import with validation and per-row error report
- [x] Bulk issue/print access codes per class
- [x] Per-subject grade weights (exams/homework/participation %)
- [x] Audit log on account create/disable/delete

### M3 — Timetable, lessons, attendance
Ships: teacher opens today's lesson and marks attendance in under a minute.

- [x] Weekly timetable slots per class (weekday, period, subject, teacher)
- [x] Lesson instances: auto-generated from timetable + ad-hoc; attachable resources
- [x] Attendance marking UI (present/absent/late), editable after the fact
- [x] Attendance history: teacher per class, per student

### M4 — Exam engine v1 (MCQ + True/False)
Ships: full exam cycle — build, schedule, take on a phone, instant results.

- [x] Question bank CRUD: MCQ + True/False, tags subject / topic (optional) / difficulty
- [x] Exam builder: pick questions manually or filter from bank; set window, time limit, marks
- [x] Attempt lifecycle: start within window, per-exam timer, continuous autosave (server + local buffer), resume after disconnect
- [x] Auto-close + auto-submit at window end (Convex scheduled function)
- [x] Instant auto-grade on submit; student sees result immediately
- [x] Teacher results table per exam; manual score override (audit-logged)

### M5 — Portal, announcements, notification center
Ships: parents stop asking — results, attendance, notes, announcements, all live.

- [x] Portal home: today's lessons, recent results, attendance summary
- [x] Results view per exam with class-average comparison
- [x] Attendance history view
- [x] Teacher notes (text) on a student + portal display
- [x] Announcements: school-wide (admin) + class scope (teacher), board UI
- [x] In-app notification center: list, unread badge, mark read
- [x] Wire triggers: new exam, results published, absence, new note, new announcement

### M6 — Gamification v1
Ships: points and streaks visible in the portal.

- [x] Point events: attendance, exam score thresholds; values admin-configurable
- [x] Streaks (consecutive active school days)
- [x] Points + streak display in portal

### M7 — Phase 1 pilot
Ships: one real class using it daily.

- [ ] Production deploy; enable Convex automatic backups — *manual: exact steps in [deploy.md](./deploy.md) "Production checklist" (Vercel link + dashboard backups toggle)*
- [ ] Onboard real data: structure, teachers, one class + printed codes — *manual: follow [pilot-runbook.md](./pilot-runbook.md)*
- [x] E2E smoke on mobile: attendance → parent sees it; exam full cycle (`npm run test:e2e`, iPhone-13 viewport)
- [ ] Run pilot with one class; collect and triage feedback — *human task; feedback template in the runbook*

## Phase 2 — full teaching workload

### M8 — Assessments v2
Ships: every question type, essay grading with rubrics and voice feedback, shuffling.

- [x] Fill-in-blank, matching, ordering: model, builder, taking UI, auto-grader
- [x] Image attachment on any question (Convex file storage)
- [x] Essay questions: manual grading queue, optional rubric, text/voice feedback (record + playback)
- [x] Combined auto+manual scoring; results publish when grading completes
- [x] Shuffle question and option order per student (seeded at attempt creation)

### M9 — Homework
Ships: assign → student submits text/photo/voice → auto-close → grade.

- [x] Homework CRUD per class with deadline
- [x] Submission: text + photos/files + in-browser voice recording; enforce caps (≤10 MB photo, ≤5 min audio)
- [x] Auto-close at deadline (scheduled function); late view is read-only
- [x] Deadline reminder notifications
- [x] Teacher grading/feedback; portal submission + grade view
- [x] Points on homework submission (gamification hook)

### M10 — Analytics & gamification full
Ships: role-scoped dashboards and live leaderboards.

- [x] Levels from cumulative points; badges for milestones
- [x] Live leaderboards: class + school
- [x] Charts: student/class/subject performance, trends over time
- [x] Student vs class average across subjects
- [x] Attendance pattern analysis
- [x] Weak-point detection from topic tags + review recommendations (untagged questions excluded)
- [x] Scope views: admin school-wide, teacher own classes, parent own child

### M11 — Report cards & attendance v2
Ships: end-of-term report card as PDF; QR check-in.

- [x] Term report computation from grade weights: subject grades, attendance summary, teacher remarks
- [x] Admin publish flow; parents see published cards only
- [x] PDF export with correct Arabic RTL rendering (print-optimized sheet → browser save-as-PDF; native Arabic shaping)
- [x] QR check-in attendance option

### M12 — PWA & push
Ships: installable app that pings parents.

- [x] Manifest, icons, install prompt (with iOS install hint)
- [x] Service worker: offline app shell
- [x] Web Push subscribe/send behind the notification-channel abstraction
- [x] Push delivery for all existing triggers; in-app center stays source of truth

## Phase 3 — ecosystem & integrity

### M13 — Messaging
- [x] Teacher ↔ parent threads, unread counts, notification trigger

### M14 — Library & calendar
- [ ] Library resources CRUD (title + link, subject/class) + portal view
- [ ] Interactive calendar: lessons, exam windows, homework deadlines, holidays/events (admin CRUD), filter by role/class

### M15 — Exam integrity v2, exports, channels
- [ ] Unique exam version per student from bank (topic/difficulty mix constraints)
- [ ] Focus-loss / tab-switch logging on attempts; count visible to teacher
- [ ] Optional no-backtrack mode
- [ ] Exportable reports (CSV/PDF: attendance, grades)
- [ ] WhatsApp/SMS adapter behind the channel abstraction
