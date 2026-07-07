import { common } from "./common";
import { auth } from "./auth";
import { nav } from "./nav";
import { portal } from "./portal";
import { structure } from "./structure";
import { students } from "./students";
import { codes } from "./codes";
import { staff } from "./staff";
import { weights } from "./weights";

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
} as const;
