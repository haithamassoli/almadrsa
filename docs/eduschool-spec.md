# E-School Platform — Full Product Specification

A build-ready specification for an AI or development team. The goal is a complete, PWA-based electronic school management system.

---

## 1. Overview

Build a **Progressive Web App (PWA)** electronic school platform that manages students, teachers, classes, attendance, assessments, and parent communication. The system has three role types (Admin, Teacher, Student/Parent), real-time analytics, gamification, a question bank, and instant auto-grading for objective questions.

**Primary goals**
- Give teachers a full toolkit to manage classes, attendance, homework, and exams.
- Give the Admin total control over the whole system.
- Give students and parents a single, passwordless, code-based account to see everything about the student's performance.
- Work smoothly on mobile as an installable PWA with push notifications.

---

## 2. Technology Stack

| Layer | Technology |
|---|---|
| Framework | **Next.js** (App Router, React Server Components) |
| Backend & Database | **Convex** (real-time database + serverless functions) |
| Realtime | Convex live queries (auto-updating dashboards, notifications, leaderboards) |
| PWA | Service Worker + Web App Manifest (installable, offline shell, push notifications) |
| Notifications | Web Push API (via PWA) — architecture should allow adding WhatsApp/SMS later |
| Styling | Any modern approach (e.g., Tailwind CSS), with **full RTL support** for Arabic |
| Auth | Custom code-based auth for Student/Parent; standard credential auth for Admin/Teacher |

**Requirements**
- Fully responsive, mobile-first UI.
- **Arabic (RTL) as a first-class language**, with an architecture ready for multiple languages (i18n).
- Dark mode support.

---

## 3. User Roles & Permissions

### 3.1 Super Admin
The highest authority in the system. Can:
- Create, edit, disable, and delete teacher, student, and parent accounts.
- Create and manage academic structure: grades, subjects, classes/sections, and academic terms.
- Assign teachers to subjects and classes.
- Configure role permissions and global platform settings.
- View system-wide reports and the full analytics dashboard.
- Access the audit log of all sensitive operations.
- Manage broadcasts and school-wide announcements.

### 3.2 Teacher
Can:
- Add students and link them to classes and subjects.
- Import students in bulk via Excel/CSV.
- Create and schedule lessons/sessions.
- Take attendance (present / absent / late), including via QR code.
- Build assessments (exams and quizzes) using multiple question types.
- Create and schedule homework assignments with deadlines.
- Add notes, evaluations, and feedback on each student's performance.
- Grade automatically (objective questions) and manually (essay questions).
- Manage the question bank for their subjects.
- Upload digital library resources (book title + link).
- Message parents/students and post class announcements.

### 3.3 Student / Parent (Unified, Code-Based Account)
A **single shared account** accessed via a **unique code, without a password**. Can:
- View all statistics and performance analytics for the student.
- View all exams and their results (with instant results for auto-graded parts).
- See attendance/absence history.
- Read teacher notes and feedback.
- View and submit homework before the deadline.
- Compare the student's performance against the class average.
- Access assigned digital library resources.
- Receive notifications and read broadcasts/announcements.
- View the interactive school calendar.
- Track gamification progress (points, badges, level, streak, leaderboard rank).

---

## 4. Authentication & Access Control

### 4.1 Admin & Teacher
Standard login (email/username + password) with role-based access control.

### 4.2 Student/Parent — Code-Based Login (No Password)
- Each student/parent account gets a **unique, long, random (non-sequential, non-guessable) code**.
- Entering the code grants access to the student's full profile.

**Security safeguards (required, because this involves minors' data):**
- Codes must be cryptographically random and non-guessable.
- Admin/Teacher can **regenerate or revoke** a code instantly if leaked.
- **Rate limiting** on code entry to prevent brute-force guessing.
- Optional **OTP / PIN on first login from a new device**, with a "remember this device" option.
- All access via code should be logged.

---

## 5. Core Modules

### 5.1 Academic Structure
Grades → Subjects → Classes/Sections → Academic Terms. Students belong to classes; teachers are assigned to subjects and classes.

### 5.2 Lessons & Scheduling
Teachers create lessons/sessions, schedule them, and attach resources. Lessons appear in the interactive school calendar.

### 5.3 Attendance
- Mark students present / absent / late per session.
- **QR-code attendance** option.
- Attendance history feeds analytics and parent notifications.

### 5.4 Assessment Engine (Exams & Quizzes)
Supported question types:
1. **Multiple Choice (MCQ)** — auto-graded.
2. **True / False** — auto-graded.
3. **Essay / Open-ended** — manually graded.
4. **Fill in the Blank** — auto-graded.
5. **Matching** — auto-graded.
6. **Ordering / Sequencing** — auto-graded.
7. **Image-based questions** — questions that include images.

**Grading**
- **Instant, automatic grading** for MCQ, True/False, Fill-in-the-Blank, Matching, and Ordering.
- **Manual grading** for essay questions, with support for a text or voice note as feedback, and optional grading rubrics.

**Exam Scheduling**
- Define a **start/end time window** for each exam.
- **Per-exam timer** (time limit).
- Auto-close submission when the window ends.

### 5.5 Homework Module (Scheduled Assignments)
- A dedicated unit to assign homework to students.
- Each assignment has a **deadline (timer)**.
- Submission is **automatically closed after the deadline**.
- Notifications remind students before the deadline.

### 5.6 Question Bank
- A reusable repository of questions.
- Categorized by subject, topic, and difficulty level.
- Teachers can pull questions from the bank when building exams.
- Supports generating **unique exam versions per student** from the bank.

### 5.7 Digital Library
- Teachers upload resources by adding a **book title + its link**.
- Resources can be linked to subjects/classes for student review.

### 5.8 Interactive School Calendar
- Shows lessons, exam dates, homework deadlines, holidays, and events.
- Interactive and filterable by role/class.

---

## 6. Gamification System
Motivate students through:
- **Points** for activities (submitting homework, high exam scores, attendance, streaks).
- **Badges / achievements** for milestones.
- **Levels** based on accumulated points.
- **Streaks** (consecutive days/activities).
- **Leaderboard** (class-level and/or school-level).

---

## 7. Analytics Dashboard
A visual, real-time analytics dashboard with role-appropriate views.

**Metrics & insights:**
- Student, class, and subject performance with visual charts.
- **Automatic weak-point detection**: identify topics where a student most frequently makes mistakes, with review recommendations.
- **Student vs. class-average comparison** to give context to each result.
- **Progress tracking over time** (trend charts).
- Attendance pattern analysis.
- Admin sees system-wide aggregate analytics; teachers see their classes; students/parents see the individual student's analytics.

---

## 8. Communication
- **Broadcasting**: send directed messages/announcements to everyone (school-wide).
- **Messaging system** between teacher and parent/student.
- **Announcements board / bulletins**: public (school-wide) or private to a specific class.

---

## 9. Exam Integrity (Anti-Cheating)
- **Shuffle question order and answer-option order** uniquely per student.
- **Generate a unique exam version per student** from the question bank.
- **Detect and log** when a student leaves the exam page (tab switch / focus loss).
- Option to **prevent returning to a previous question**.

---

## 10. Notifications (PWA)
- Installable PWA with **Web Push notifications**.
- Trigger notifications for: new exam/homework, approaching deadline, published results, new note/feedback, attendance alerts, and broadcasts.
- Architecture should allow adding **WhatsApp/SMS** channels later.

---

## 11. Administration & Safety
- **Bulk student import** via Excel/CSV.
- **Audit log** for all sensitive operations.
- **Automatic data backup**.
- Role-based access control enforced on both client and Convex server functions.

---

## 12. Non-Functional Requirements
- **PWA**: installable, offline app shell, push notifications.
- **Real-time**: dashboards, leaderboards, notifications, and results update live via Convex.
- **Localization**: Arabic (RTL) first-class; i18n-ready for multiple languages.
- **Accessibility & UX**: mobile-first, responsive, dark mode.
- **Performance**: fast load, optimized for mobile networks.
- **Security & Privacy**: this handles minors' data — enforce least-privilege access, secure code-based auth, rate limiting, and logging.

---

## 13. Suggested Data Model (High-Level, for Convex)
Core tables to consider:
- `users` (role: admin | teacher | student | parent)
- `accessCodes` (code, linked studentId, status, deviceTokens)
- `grades`, `subjects`, `classes`, `terms`
- `enrollments` (student ↔ class ↔ subject)
- `lessons` (schedule, resources, classId)
- `attendance` (studentId, lessonId, status, timestamp)
- `questions` (type, subject, topic, difficulty, options, correctAnswer, image)
- `exams` (questions or bank refs, timeWindow, timer, settings)
- `examAttempts` (studentId, shuffledOrder, answers, autoScore, manualScore, flags)
- `homework` (assignment, deadline, classId)
- `homeworkSubmissions` (studentId, content, submittedAt)
- `notes` (studentId, teacherId, text/voice feedback)
- `gamification` (studentId, points, level, badges, streak)
- `messages` (sender, receiver, thread)
- `announcements` (scope: school | class, targetId)
- `libraryResources` (title, link, subjectId)
- `notifications` (userId, type, payload, read)
- `auditLog` (actor, action, target, timestamp)

---

## 14. Suggested Build Phases

**Phase 1 — MVP (Foundation)**
Admin + Teacher roles + Student/Parent code-based login. Academic structure, lessons, attendance, MCQ & True/False exams with instant auto-grading, basic question bank, and basic statistics.

**Phase 2 — Engagement & Depth**
Gamification, advanced analytics dashboard, PWA + push notifications, remaining question types (fill-in-blank, matching, ordering, image, essay) with manual grading, homework module, and exam scheduling.

**Phase 3 — Collaboration & Integrity**
Digital library, messaging, broadcasting, announcements board, exam anti-cheating measures, interactive school calendar, exportable reports, and WhatsApp/SMS integration.
