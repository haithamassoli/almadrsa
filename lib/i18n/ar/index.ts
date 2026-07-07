import { common } from "./common";
import { auth } from "./auth";
import { nav } from "./nav";
import { portal } from "./portal";
import { structure } from "./structure";
import { students } from "./students";
import { codes } from "./codes";
import { staff } from "./staff";
import { weights } from "./weights";
import { timetable } from "./timetable";
import { lessons } from "./lessons";
import { attendance } from "./attendance";
import { questions } from "./questions";
import { exams } from "./exams";
import { examsPortal } from "./examsPortal";
import { notes } from "./notes";
import { announce } from "./announce";
import { gamification } from "./gamification";
import { homework } from "./homework";
import { homeworkPortal } from "./homeworkPortal";
import { analytics } from "./analytics";
import { progress } from "./progress";

// One namespace file per feature area so parallel work never edits the same
// file. All namespaces are pre-registered here — add keys in YOUR namespace
// file, never edit this index.
export const ar = {
  common,
  auth,
  nav,
  portal,
  structure,
  students,
  codes,
  staff,
  weights,
  timetable,
  lessons,
  attendance,
  questions,
  exams,
  examsPortal,
  notes,
  announce,
  gamification,
  homework,
  homeworkPortal,
  analytics,
  progress,
} as const;
