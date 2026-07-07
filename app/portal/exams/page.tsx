"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Award, CalendarClock, ClipboardList, Timer } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime, formatNumber, t } from "@/lib/i18n";
import { useStudentSession } from "@/lib/student-session";

type ExamRow = FunctionReturnType<typeof api.attempts.listForStudent>[number];

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-sm font-bold text-muted-foreground">{children}</h2>;
}

/** Open-window exam: the prominent card with the start/resume CTA. */
function AvailableCard({ row }: { row: ExamRow }) {
  const inProgress = row.state === "in_progress";
  return (
    <div className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate font-bold">{row.title}</span>
          <span className="truncate text-sm text-muted-foreground">
            {row.subjectName}
          </span>
        </div>
        {inProgress ? (
          <Badge variant="secondary" className="shrink-0">
            {t("examsPortal.inProgressBadge")}
          </Badge>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <CalendarClock className="size-3.5 shrink-0" aria-hidden />
          {t("examsPortal.endsAt", { time: formatDateTime(row.windowEnd) })}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Timer className="size-3.5 shrink-0" aria-hidden />
          {t("examsPortal.duration", {
            minutes: formatNumber(row.timeLimitMinutes),
          })}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Award className="size-3.5 shrink-0" aria-hidden />
          {t("examsPortal.marksTotal", { marks: formatNumber(row.totalMarks) })}
        </span>
      </div>
      <Button
        className="w-full bg-accent text-accent-foreground hover:bg-accent/80"
        render={<Link href={`/portal/exams/${row.examId}`} />}
      >
        {inProgress ? t("examsPortal.resume") : t("examsPortal.start")}
      </Button>
    </div>
  );
}

/** Not-yet-open exam: muted card with the window start. */
function UpcomingCard({ row }: { row: ExamRow }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-2xl border border-dashed bg-muted/40 p-4">
      <span className="truncate font-medium">{row.title}</span>
      <span className="truncate text-sm text-muted-foreground">
        {row.subjectName}
      </span>
      <span className="mt-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground">
        <CalendarClock className="size-3.5 shrink-0" aria-hidden />
        {t("examsPortal.startsAt", { time: formatDateTime(row.windowStart) })}
      </span>
    </div>
  );
}

/**
 * Submitted, pending-grading or missed exam: compact row; submitted and
 * pending rows open the result/receipt screen. Pending (essay exam not yet
 * fully graded) shows the accent badge instead of a score — never a score.
 */
function PastRow({ row }: { row: ExamRow }) {
  const inner = (
    <>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm font-medium">{row.title}</span>
        <span className="truncate text-xs text-muted-foreground">
          {row.subjectName}
        </span>
      </div>
      {row.state === "submitted" ? (
        <Badge variant="secondary" className="shrink-0 tabular-nums">
          {t("examsPortal.scoreFraction", {
            score: formatNumber(row.score ?? 0),
            total: formatNumber(row.totalMarks),
          })}
        </Badge>
      ) : row.state === "pending_grading" ? (
        <Badge className="shrink-0 bg-accent text-accent-foreground">
          {t("examsPortal.pendingGradingBadge")}
        </Badge>
      ) : (
        <span className="shrink-0 text-xs text-muted-foreground">
          {t("examsPortal.notSubmitted")}
        </span>
      )}
    </>
  );
  if (row.state === "submitted" || row.state === "pending_grading") {
    return (
      <Link
        href={`/portal/exams/${row.examId}`}
        className="flex items-center justify-between gap-3 rounded-xl border p-3 outline-none transition-colors hover:border-primary/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {inner}
      </Link>
    );
  }
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border p-3">
      {inner}
    </div>
  );
}

export default function PortalExamsPage() {
  const { sessionToken, ready } = useStudentSession();
  const rows = useQuery(
    api.attempts.listForStudent,
    ready && sessionToken ? { sessionToken } : "skip",
  );

  if (rows === undefined) {
    return (
      <div className="flex flex-1 flex-col gap-6">
        <h1 className="heading-rule text-2xl font-black">
          {t("examsPortal.title")}
        </h1>
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-36 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  const available = rows
    .filter((row) => row.state === "available" || row.state === "in_progress")
    .sort((a, b) => a.windowEnd - b.windowEnd);
  const upcoming = rows
    .filter((row) => row.state === "upcoming")
    .sort((a, b) => a.windowStart - b.windowStart);
  const past = rows.filter(
    (row) =>
      row.state === "submitted" ||
      row.state === "pending_grading" ||
      row.state === "missed",
  );

  return (
    <div className="flex flex-1 flex-col gap-6">
      <h1 className="heading-rule text-2xl font-black">
        {t("examsPortal.title")}
      </h1>

      {rows.length === 0 ? (
        <Empty className="flex-1 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ClipboardList />
            </EmptyMedia>
            <EmptyTitle>{t("examsPortal.emptyTitle")}</EmptyTitle>
            <EmptyDescription>{t("examsPortal.emptyBody")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          {available.length > 0 ? (
            <section className="flex flex-col gap-3">
              <SectionHeading>
                {t("examsPortal.sectionAvailable")}
              </SectionHeading>
              {available.map((row) => (
                <AvailableCard key={row.examId} row={row} />
              ))}
            </section>
          ) : null}

          {upcoming.length > 0 ? (
            <section className="flex flex-col gap-3">
              <SectionHeading>{t("examsPortal.sectionUpcoming")}</SectionHeading>
              {upcoming.map((row) => (
                <UpcomingCard key={row.examId} row={row} />
              ))}
            </section>
          ) : null}

          {past.length > 0 ? (
            <section className="flex flex-col gap-3">
              <SectionHeading>{t("examsPortal.sectionPast")}</SectionHeading>
              {past.map((row) => (
                <PastRow key={row.examId} row={row} />
              ))}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
