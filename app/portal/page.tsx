"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ArrowLeft } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, formatNumber, t } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n";
import { useStudentSession } from "@/lib/student-session";
import { cn } from "@/lib/utils";

type HomeData = FunctionReturnType<typeof api.portal.home>;

// ——— Date helpers (local YYYY-MM-DD from Date parts, never UTC) ———

function localDateKey(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function todayKey(): string {
  return localDateKey(new Date());
}

function thirtyDaysAgoKey(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return localDateKey(d);
}

// ——— Shared presentational pieces (module scope) ———

const STATUS_BADGE: Record<
  "present" | "late" | "absent",
  { labelKey: MessageKey; className: string }
> = {
  present: {
    labelKey: "portal.statusPresent",
    className: "bg-success/10 text-success",
  },
  late: {
    labelKey: "portal.statusLate",
    className: "bg-accent text-accent-foreground",
  },
  absent: {
    labelKey: "portal.statusAbsent",
    className: "bg-destructive/10 text-destructive",
  },
};

function StatusBadge({ status }: { status: "present" | "late" | "absent" }) {
  const badge = STATUS_BADGE[status];
  return (
    <Badge
      variant="outline"
      className={cn("shrink-0 border-transparent", badge.className)}
    >
      {t(badge.labelKey)}
    </Badge>
  );
}

function CardEmptyText({ children }: { children: React.ReactNode }) {
  return (
    <p className="py-2 text-center text-sm text-muted-foreground">{children}</p>
  );
}

function HomeSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-40" />
      </div>
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-40 rounded-2xl" />
      ))}
    </div>
  );
}

// ——— Section 1: today's lessons ———

function TodayCard({ lessons }: { lessons: HomeData["todayLessons"] }) {
  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle>{t("portal.todayTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        {lessons.length === 0 ? (
          <CardEmptyText>{t("portal.todayEmpty")}</CardEmptyText>
        ) : (
          <div className="divide-y">
            {lessons.map((lesson) => (
              <div
                key={lesson.lessonId}
                className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
              >
                <span className="sr-only">
                  {t("portal.periodN", { n: formatNumber(lesson.period) })}
                </span>
                <span
                  aria-hidden
                  className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary tabular-nums"
                >
                  {formatNumber(lesson.period)}
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">
                    {lesson.subjectName}
                  </span>
                  {lesson.title ? (
                    <span className="truncate text-xs text-muted-foreground">
                      {lesson.title}
                    </span>
                  ) : null}
                </div>
                {lesson.myStatus ? (
                  <StatusBadge status={lesson.myStatus} />
                ) : (
                  <span className="shrink-0 text-muted-foreground">
                    <span aria-hidden>—</span>
                    <span className="sr-only">
                      {t("portal.statusNotMarked")}
                    </span>
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ——— Section 2: latest results ———

function ResultsCard({ results }: { results: HomeData["recentResults"] }) {
  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle>{t("portal.resultsTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        {results.length === 0 ? (
          <CardEmptyText>{t("portal.resultsEmpty")}</CardEmptyText>
        ) : (
          <div className="divide-y">
            {results.map((result) => (
              <Link
                key={result.examId}
                href={`/portal/exams/${result.examId}`}
                className="flex items-center justify-between gap-3 py-2.5 outline-none transition-colors first:pt-0 last:pb-0 hover:text-primary focus-visible:text-primary"
              >
                <span className="min-w-0 truncate font-medium">
                  {result.title}
                </span>
                <Badge variant="secondary" className="shrink-0 tabular-nums">
                  {t("portal.scoreFraction", {
                    score: formatNumber(result.score),
                    total: formatNumber(result.maxScore),
                  })}
                </Badge>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ——— Section 3: attendance summary (last 30 days) ———

function AttendanceStatTile({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl bg-muted/50 p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("text-xl font-black tabular-nums", valueClassName)}>
        {value}
      </span>
    </div>
  );
}

function AttendanceCard({ summary }: { summary: HomeData["attendance"] }) {
  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle>{t("portal.attendanceSummaryTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <AttendanceStatTile
            label={t("portal.statusPresent")}
            value={formatNumber(summary.present)}
            valueClassName="text-success"
          />
          <AttendanceStatTile
            label={t("portal.statusLate")}
            value={formatNumber(summary.late)}
            valueClassName="text-accent-foreground"
          />
          <AttendanceStatTile
            label={t("portal.statusAbsent")}
            value={formatNumber(summary.absent)}
            valueClassName="text-destructive"
          />
          <AttendanceStatTile
            label={t("portal.attendanceRate")}
            value={`${formatNumber(summary.rate)}%`}
          />
        </div>
      </CardContent>
      <CardFooter>
        <Link
          href="/portal/attendance"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary outline-none hover:underline focus-visible:underline"
        >
          {t("portal.attendanceViewAll")}
          <ArrowLeft className="size-4" aria-hidden />
        </Link>
      </CardFooter>
    </Card>
  );
}

// ——— Section 4: teacher notes (hidden when empty) ———

function NotesCard({ notes }: { notes: HomeData["notes"] }) {
  if (notes.length === 0) return null;
  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle>{t("portal.notesTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="divide-y">
          {notes.map((note, i) => (
            <div
              key={`${note._creationTime}-${i}`}
              className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0"
            >
              <p className="text-sm leading-relaxed whitespace-pre-wrap">
                {note.text}
              </p>
              <span className="text-xs text-muted-foreground">
                {note.teacherName} · {formatDate(note._creationTime)}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ——— Section 5: announcements (hidden when empty) ———

function AnnouncementsCard({
  announcements,
}: {
  announcements: HomeData["announcements"];
}) {
  if (announcements.length === 0) return null;
  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle>{t("portal.announcementsTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="divide-y">
          {announcements.map((announcement) => (
            <div
              key={announcement._id}
              className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0"
            >
              <span className="font-bold">{announcement.title}</span>
              <p className="line-clamp-2 text-sm leading-relaxed">
                {announcement.body}
              </p>
              <span className="text-xs text-muted-foreground">
                {announcement.authorName} ·{" "}
                {formatDate(announcement._creationTime)}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
      <CardFooter>
        <Link
          href="/portal/announcements"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary outline-none hover:underline focus-visible:underline"
        >
          {t("portal.announcementsViewAll")}
          <ArrowLeft className="size-4" aria-hidden />
        </Link>
      </CardFooter>
    </Card>
  );
}

// ——— Page ———

export default function PortalHome() {
  const { sessionToken, ready } = useStudentSession();
  // Stable per mount: the home window doesn't shift while the page is open.
  const [dates] = useState(() => ({
    date: todayKey(),
    from: thirtyDaysAgoKey(),
  }));
  const home = useQuery(
    api.portal.home,
    ready && sessionToken ? { sessionToken, ...dates } : "skip",
  );

  if (home === undefined) return <HomeSkeleton />;

  const name = `${home.student.firstName} ${home.student.lastName}`;

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="heading-rule text-2xl font-black">
          {t("portal.greeting", { name })}
        </h1>
        <p className="text-sm text-muted-foreground">{t("portal.subtitle")}</p>
      </div>

      <TodayCard lessons={home.todayLessons} />
      <ResultsCard results={home.recentResults} />
      <AttendanceCard summary={home.attendance} />
      <NotesCard notes={home.notes} />
      <AnnouncementsCard announcements={home.announcements} />
    </div>
  );
}
