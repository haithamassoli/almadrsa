/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as academics from "../academics.js";
import type * as admin from "../admin.js";
import type * as analytics from "../analytics.js";
import type * as announcements from "../announcements.js";
import type * as app from "../app.js";
import type * as attempts from "../attempts.js";
import type * as attendance from "../attendance.js";
import type * as auth from "../auth.js";
import type * as calendar from "../calendar.js";
import type * as channelActions from "../channelActions.js";
import type * as checkin from "../checkin.js";
import type * as codes from "../codes.js";
import type * as events from "../events.js";
import type * as exams from "../exams.js";
import type * as files from "../files.js";
import type * as gamification from "../gamification.js";
import type * as homework from "../homework.js";
import type * as http from "../http.js";
import type * as lessons from "../lessons.js";
import type * as lib_audit from "../lib/audit.js";
import type * as lib_channels from "../lib/channels.js";
import type * as lib_crypto from "../lib/crypto.js";
import type * as lib_dates from "../lib/dates.js";
import type * as lib_grading from "../lib/grading.js";
import type * as lib_notify from "../lib/notify.js";
import type * as lib_shuffle from "../lib/shuffle.js";
import type * as lib_validators from "../lib/validators.js";
import type * as library from "../library.js";
import type * as messages from "../messages.js";
import type * as notes from "../notes.js";
import type * as notifications from "../notifications.js";
import type * as portal from "../portal.js";
import type * as push from "../push.js";
import type * as pushActions from "../pushActions.js";
import type * as questions from "../questions.js";
import type * as reports from "../reports.js";
import type * as seed from "../seed.js";
import type * as staff from "../staff.js";
import type * as studentAuth from "../studentAuth.js";
import type * as students from "../students.js";
import type * as timetable from "../timetable.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  academics: typeof academics;
  admin: typeof admin;
  analytics: typeof analytics;
  announcements: typeof announcements;
  app: typeof app;
  attempts: typeof attempts;
  attendance: typeof attendance;
  auth: typeof auth;
  calendar: typeof calendar;
  channelActions: typeof channelActions;
  checkin: typeof checkin;
  codes: typeof codes;
  events: typeof events;
  exams: typeof exams;
  files: typeof files;
  gamification: typeof gamification;
  homework: typeof homework;
  http: typeof http;
  lessons: typeof lessons;
  "lib/audit": typeof lib_audit;
  "lib/channels": typeof lib_channels;
  "lib/crypto": typeof lib_crypto;
  "lib/dates": typeof lib_dates;
  "lib/grading": typeof lib_grading;
  "lib/notify": typeof lib_notify;
  "lib/shuffle": typeof lib_shuffle;
  "lib/validators": typeof lib_validators;
  library: typeof library;
  messages: typeof messages;
  notes: typeof notes;
  notifications: typeof notifications;
  portal: typeof portal;
  push: typeof push;
  pushActions: typeof pushActions;
  questions: typeof questions;
  reports: typeof reports;
  seed: typeof seed;
  staff: typeof staff;
  studentAuth: typeof studentAuth;
  students: typeof students;
  timetable: typeof timetable;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("../betterAuth/_generated/component.js").ComponentApi<"betterAuth">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};
