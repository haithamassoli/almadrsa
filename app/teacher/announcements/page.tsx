"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AnnouncementsBoard } from "@/components/announcements-board";

export default function TeacherAnnouncementsPage() {
  // An admin never routes here in practice, but if one does they keep their
  // school-wide scope; a teacher is class-scoped only.
  const me = useQuery(api.staff.currentUser, {});
  return <AnnouncementsBoard canSchoolScope={me?.role === "admin"} />;
}
