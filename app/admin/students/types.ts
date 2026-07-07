import type { Id } from "@/convex/_generated/dataModel";

/** Row shape returned by api.students.listStudents. */
export type StudentRow = {
  _id: Id<"students">;
  firstName: string;
  lastName: string;
  guardianName?: string;
  guardianPhone?: string;
  status: "active" | "archived";
  classId?: Id<"classes">;
  className?: string;
};

/** Row shape returned by api.academics.listAllClasses. */
export type ClassOption = {
  _id: Id<"classes">;
  name: string;
  gradeId: Id<"grades">;
  gradeName: string;
};
