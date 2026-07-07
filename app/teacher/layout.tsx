import { StaffShell } from "@/components/app-shell/staff-shell";

export default function TeacherLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <StaffShell role="teacher">{children}</StaffShell>;
}
