"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { GraduationCap, LogOut } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { t } from "@/lib/i18n";
import {
  clearSession,
  studentFetch,
  useStudentSession,
} from "@/lib/student-session";

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { sessionToken, ready } = useStudentSession();
  const me = useQuery(
    api.studentAuth.me,
    ready && sessionToken ? { sessionToken } : "skip",
  );

  const invalid = ready && (!sessionToken || me === null);
  useEffect(() => {
    if (invalid) {
      clearSession();
      router.replace("/code");
    }
  }, [invalid, router]);

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
    clearSession();
    router.replace("/code");
  }

  return (
    <div className="flex flex-1 flex-col">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b bg-background/95 px-4 py-3 backdrop-blur">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <GraduationCap className="size-4" aria-hidden />
        </span>
        <div className="flex flex-1 flex-col">
          <span className="text-sm font-bold">{t("common.appName")}</span>
          <span className="text-xs text-muted-foreground">
            {me.student.firstName} {me.student.lastName}
          </span>
        </div>
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
      <main className="flex flex-1 flex-col p-4">{children}</main>
    </div>
  );
}
