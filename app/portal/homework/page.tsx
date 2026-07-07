"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Award, BookOpenCheck, CalendarClock } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
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
import { cn } from "@/lib/utils";

type HomeworkRow = FunctionReturnType<
  typeof api.homework.listForStudent
>[number];

/** The closes-at line turns destructive under this much time left. */
const DUE_SOON_MS = 24 * 60 * 60 * 1000;

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-sm font-bold text-muted-foreground">{children}</h2>;
}

/** Open homework: prominent card, whole surface links to the detail. */
function OpenCard({ row, now }: { row: HomeworkRow; now: number }) {
  const dueSoon = row.deadline - now < DUE_SOON_MS;
  return (
    <Link
      href={`/portal/homework/${row.homeworkId}`}
      className="flex flex-col gap-3 rounded-2xl border bg-card p-4 outline-none transition-colors hover:border-primary/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate font-bold">{row.title}</span>
          <span className="truncate text-sm text-muted-foreground">
            {row.subjectName}
          </span>
        </div>
        {row.state === "open_submitted" ? (
          <Badge
            variant="outline"
            className="shrink-0 border-transparent bg-success/10 text-success"
          >
            {t("homeworkPortal.submittedChip")}
          </Badge>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
        <span
          className={cn(
            "inline-flex items-center gap-1.5",
            dueSoon && "font-medium text-destructive",
          )}
        >
          <CalendarClock className="size-3.5 shrink-0" aria-hidden />
          {t("homeworkPortal.closesAt", { time: formatDateTime(row.deadline) })}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Award className="size-3.5 shrink-0" aria-hidden />
          {t("homeworkPortal.marksTotal", { marks: formatNumber(row.marks) })}
        </span>
      </div>
    </Link>
  );
}

/** Closed homework: compact row with the submission/grade outcome. */
function PastRow({ row }: { row: HomeworkRow }) {
  return (
    <Link
      href={`/portal/homework/${row.homeworkId}`}
      className="flex items-center justify-between gap-3 rounded-xl border p-3 outline-none transition-colors hover:border-primary/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm font-medium">{row.title}</span>
        <span className="truncate text-xs text-muted-foreground">
          {row.subjectName}
        </span>
      </div>
      {row.grade !== undefined ? (
        <Badge variant="secondary" className="shrink-0 tabular-nums">
          {t("homeworkPortal.gradeFraction", {
            grade: formatNumber(row.grade),
            total: formatNumber(row.marks),
          })}
        </Badge>
      ) : row.state === "closed_submitted" ? (
        <span className="shrink-0 text-xs text-success">
          {t("homeworkPortal.submittedChip")}
        </span>
      ) : (
        <span className="shrink-0 text-xs text-muted-foreground">
          {t("homeworkPortal.notSubmitted")}
        </span>
      )}
    </Link>
  );
}

export default function PortalHomeworkPage() {
  const { sessionToken, ready } = useStudentSession();
  const rows = useQuery(
    api.homework.listForStudent,
    ready && sessionToken ? { sessionToken } : "skip",
  );
  // Page-load timestamp — render-stable reference for the due-soon styling.
  const [now] = useState(() => Date.now());

  if (rows === undefined) {
    return (
      <div className="flex flex-1 flex-col gap-6">
        <h1 className="heading-rule text-2xl font-black">
          {t("homeworkPortal.title")}
        </h1>
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  // The query returns open first (nearest deadline first), then closed
  // (newest deadline first) — partitioning preserves both orders.
  const open = rows.filter((row) => row.status === "open");
  const past = rows.filter((row) => row.status === "closed");

  return (
    <div className="flex flex-1 flex-col gap-6">
      <h1 className="heading-rule text-2xl font-black">
        {t("homeworkPortal.title")}
      </h1>

      {rows.length === 0 ? (
        <Empty className="flex-1 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BookOpenCheck />
            </EmptyMedia>
            <EmptyTitle>{t("homeworkPortal.emptyTitle")}</EmptyTitle>
            <EmptyDescription>{t("homeworkPortal.emptyBody")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          {open.length > 0 ? (
            <section className="flex flex-col gap-3">
              <SectionHeading>{t("homeworkPortal.sectionOpen")}</SectionHeading>
              {open.map((row) => (
                <OpenCard key={row.homeworkId} row={row} now={now} />
              ))}
            </section>
          ) : null}

          {past.length > 0 ? (
            <section className="flex flex-col gap-3">
              <SectionHeading>{t("homeworkPortal.sectionPast")}</SectionHeading>
              {past.map((row) => (
                <PastRow key={row.homeworkId} row={row} />
              ))}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
