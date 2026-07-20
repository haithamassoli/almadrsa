"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import {
  Bell,
  BookOpenCheck,
  CalendarCheck,
  Check,
  ChevronsUpDown,
  ClipboardList,
  Home,
  LogOut,
  Megaphone,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { InstallPrompt } from "@/components/install-prompt";
import { PushSubscribe } from "@/components/push-subscribe";
import { LogoMark } from "@/components/app-shell/logo-mark";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { ThemeToggle } from "@/components/app-shell/theme-toggle";
import { t } from "@/lib/i18n";
import {
  backfillActiveAccount,
  removeActiveAccount,
  studentFetch,
  switchAccount,
  useStudentAccounts,
  useStudentSession,
} from "@/lib/student-session";
import { cn } from "@/lib/utils";
import type { MessageKey } from "@/lib/i18n";

const PORTAL_NAV: {
  href: string;
  labelKey: MessageKey;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { href: "/portal", labelKey: "portal.navHome", icon: Home },
  { href: "/portal/exams", labelKey: "portal.navExams", icon: ClipboardList },
  {
    href: "/portal/homework",
    labelKey: "portal.navHomework",
    icon: BookOpenCheck,
  },
  {
    href: "/portal/attendance",
    labelKey: "portal.navAttendance",
    icon: CalendarCheck,
  },
  {
    href: "/portal/announcements",
    labelKey: "portal.navAnnouncements",
    icon: Megaphone,
  },
  {
    href: "/portal/notifications",
    labelKey: "portal.navNotifications",
    icon: Bell,
  },
];

function PortalNav({ sessionToken }: { sessionToken: string }) {
  const pathname = usePathname();
  const unread = useQuery(api.notifications.unreadCount, { sessionToken });
  return (
    <nav className="sticky bottom-0 z-10 border-t bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-2xl items-stretch">
        {PORTAL_NAV.map((item) => {
          const active =
            item.href === "/portal"
              ? pathname === item.href
              : pathname.startsWith(item.href);
          const showBadge =
            item.href === "/portal/notifications" && (unread ?? 0) > 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-1 flex-col items-center gap-1 py-2.5 text-xs font-medium transition-colors",
                active
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <span className="relative">
                <item.icon className="size-5" aria-hidden />
                {showBadge ? (
                  <span
                    className="absolute -top-1 -end-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-none text-white"
                    aria-label={t("portal.unreadCount", {
                      count: unread ?? 0,
                    })}
                  >
                    {(unread ?? 0) > 99 ? "99+" : unread}
                  </span>
                ) : null}
              </span>
              {t(item.labelKey)}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { sessionToken, ready } = useStudentSession();
  const accounts = useStudentAccounts();
  const me = useQuery(
    api.studentAuth.me,
    ready && sessionToken ? { sessionToken } : "skip",
  );

  const invalid = ready && (!sessionToken || me === null);
  useEffect(() => {
    if (invalid) {
      const next = removeActiveAccount();
      if (next === null) {
        router.replace("/code");
      } else {
        toast(t("portal.sessionExpiredSwitched"));
      }
    }
  }, [invalid, router]);

  // Repair migrated/stale switcher entries once the active session resolves.
  useEffect(() => {
    if (me) {
      backfillActiveAccount({
        studentId: me.student._id,
        name: `${me.student.firstName} ${me.student.lastName}`,
      });
    }
  }, [me]);

  if (!ready || !sessionToken || me === undefined || me === null) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );
  }

  async function signOut() {
    if (sessionToken) {
      try {
        await studentFetch("/student/logout", { sessionToken });
      } catch {
        // Session removal is best-effort; local state clears regardless.
      }
    }
    if (removeActiveAccount() === null) router.replace("/code");
  }

  return (
    <div className="flex flex-1 flex-col">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b bg-background/95 px-4 py-3 backdrop-blur">
        <LogoMark className="size-8" />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                className="h-auto flex-1 justify-start gap-2 px-2 py-1"
              />
            }
          >
            <span className="flex min-w-0 flex-col items-start text-start">
              <span className="text-sm font-bold">{t("common.appName")}</span>
              <span className="truncate text-xs font-normal text-muted-foreground">
                {me.student.firstName} {me.student.lastName}
              </span>
            </span>
            <ChevronsUpDown
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-52">
            {accounts.map((account) => (
              <DropdownMenuItem
                key={account.sessionToken}
                onClick={() => switchAccount(account.studentId)}
              >
                {account.sessionToken === sessionToken ? (
                  <Check aria-hidden />
                ) : (
                  <span className="size-4" aria-hidden />
                )}
                {account.name || t("portal.switchStudent")}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push("/code")}>
              <Plus aria-hidden />
              {t("portal.addStudent")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <ThemeToggle />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void signOut()}
          aria-label={t("auth.signOut")}
        >
          <LogOut className="size-4" aria-hidden />
          {t("auth.signOut")}
        </Button>
      </header>
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col p-4">
        {children}
      </main>
      <InstallPrompt />
      <PushSubscribe />
      <PortalNav sessionToken={sessionToken} />
    </div>
  );
}
