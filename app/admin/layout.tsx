import { StaffShell } from "@/components/app-shell/staff-shell";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <StaffShell role="admin">{children}</StaffShell>;
}
