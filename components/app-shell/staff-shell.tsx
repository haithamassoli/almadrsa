"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import {
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  FileQuestion,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  Network,
  Scale,
  StickyNote,
  UserCog,
  Users,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import { AppWordmark } from "@/components/app-shell/app-wordmark";
import { ThemeToggle } from "@/components/app-shell/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth-client";
import { t, type MessageKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type Role = "admin" | "teacher";

type NavItem = {
  href: string;
  labelKey: MessageKey;
  icon: React.ComponentType<{ className?: string }>;
};

const NAV: Record<Role, NavItem[]> = {
  admin: [
    { href: "/admin", labelKey: "nav.dashboard", icon: LayoutDashboard },
    { href: "/admin/structure", labelKey: "nav.structure", icon: Network },
    { href: "/admin/timetable", labelKey: "nav.timetable", icon: CalendarDays },
    { href: "/admin/students", labelKey: "nav.students", icon: Users },
    { href: "/admin/codes", labelKey: "nav.codes", icon: KeyRound },
    { href: "/admin/staff", labelKey: "nav.staff", icon: UserCog },
    { href: "/admin/weights", labelKey: "nav.weights", icon: Scale },
    {
      href: "/admin/announcements",
      labelKey: "nav.announcements",
      icon: Megaphone,
    },
  ],
  teacher: [
    { href: "/teacher", labelKey: "nav.teacherHome", icon: LayoutDashboard },
    {
      href: "/teacher/attendance",
      labelKey: "nav.attendance",
      icon: ClipboardCheck,
    },
    {
      href: "/teacher/questions",
      labelKey: "nav.questions",
      icon: FileQuestion,
    },
    { href: "/teacher/exams", labelKey: "nav.exams", icon: ClipboardList },
    { href: "/teacher/notes", labelKey: "nav.notes", icon: StickyNote },
    {
      href: "/teacher/announcements",
      labelKey: "nav.announcements",
      icon: Megaphone,
    },
  ],
};

function NavLinks({ role, onNavigate }: { role: Role; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1">
      {NAV[role].map((item) => {
        const active =
          item.href === `/${role}` || item.href === "/admin"
            ? pathname === item.href
            : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
            )}
          >
            <item.icon className="size-4" aria-hidden />
            {t(item.labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}

export function StaffShell({
  role,
  children,
}: {
  role: Role;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const user = useQuery(api.staff.currentUser);
  const [sheetOpen, setSheetOpen] = useState(false);

  const denied =
    user === null || (user !== undefined && user.role !== role);
  useEffect(() => {
    if (user === null) {
      // Preserve a deep target for post-login, but for the area root itself
      // (the common sign-out case) land on a clean /login.
      router.replace(
        pathname === `/${role}`
          ? "/login"
          : `/login?redirect=${encodeURIComponent(pathname)}`,
      );
    } else if (user && user.role !== role) {
      router.replace(user.role === "admin" ? "/admin" : "/teacher");
    }
  }, [user, role, router, pathname]);

  if (user === undefined || denied) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );
  }

  async function signOut() {
    await authClient.signOut();
    router.replace("/login");
  }

  const sidebar = (
    <div className="flex h-full flex-col gap-6 p-4">
      <Link
        href={`/${role}`}
        onClick={() => setSheetOpen(false)}
        className="rounded-lg px-1 outline-none focus-visible:ring-3 focus-visible:ring-sidebar-ring/50"
      >
        <AppWordmark />
      </Link>
      <NavLinks role={role} onNavigate={() => setSheetOpen(false)} />
      <div className="mt-auto flex items-center gap-2 border-t pt-4">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{user.name}</span>
          <Badge variant="secondary" className="w-fit text-xs">
            {user.role === "admin" ? t("auth.roleAdmin") : t("auth.roleTeacher")}
          </Badge>
        </div>
        <ThemeToggle />
        <Button
          variant="ghost"
          size="icon"
          onClick={() => void signOut()}
          aria-label={t("auth.signOut")}
        >
          <LogOut className="size-4" aria-hidden />
        </Button>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-dvh flex-1">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 border-e bg-sidebar text-sidebar-foreground md:block">
        {sidebar}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b px-4 py-3 md:hidden">
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("nav.openMenu")}
                />
              }
            >
              <Menu className="size-5" aria-hidden />
            </SheetTrigger>
            <SheetContent side="right" className="w-72 p-0">
              <SheetHeader className="sr-only">
                <SheetTitle>{t("nav.menu")}</SheetTitle>
              </SheetHeader>
              <div className="h-full bg-sidebar text-sidebar-foreground">
                {sidebar}
              </div>
            </SheetContent>
          </Sheet>
          <AppWordmark size="sm" />
        </header>
        <main className="flex flex-1 flex-col p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
