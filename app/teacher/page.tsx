"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { CalendarPlus, Plus } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { AdhocDialog } from "./adhoc-dialog";

/** Row shape returned by api.lessons.listMine. */
type TodayLesson = {
  _id: Id<"lessons">;
  period: number;
  source: "timetable" | "adhoc";
  title?: string;
  className: string;
  subjectName: string;
  classId: Id<"classes">;
  markedCount: number;
  enrolledCount: number;
};

/** Local-timezone YYYY-MM-DD (toISOString would shift the day to UTC). */
function localDateKey(): string {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

export default function TeacherTodayPage() {
  const [today] = useState(localDateKey);
  const user = useQuery(api.staff.currentUser);
  const lessons = useQuery(api.lessons.listMine, { date: today });
  const ensureLessons = useMutation(api.lessons.ensureLessonsForDate);
  const [adhocOpen, setAdhocOpen] = useState(false);

  // Materialize today's timetable slots into lesson rows exactly once per
  // mount (idempotent server-side; the ref also guards StrictMode replays).
  const ensuredRef = useRef(false);
  useEffect(() => {
    if (ensuredRef.current) return;
    ensuredRef.current = true;
    void ensureLessons({ date: today }).catch(() => {
      // Non-fatal: the list still shows already-materialized lessons.
    });
  }, [ensureLessons, today]);

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          {user ? (
            <h1 className="heading-rule text-2xl font-black">
              {t("nav.greeting", { name: user.name })}
            </h1>
          ) : (
            <Skeleton className="h-8 w-44" />
          )}
          <p className="ps-3 text-sm text-muted-foreground">
            {formatDate(new Date(`${today}T00:00:00`).getTime())}
          </p>
        </div>
        <Button onClick={() => setAdhocOpen(true)}>
          <Plus />
          {t("lessons.addAdhoc")}
        </Button>
      </div>

      {lessons === undefined ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-21 rounded-2xl" />
          ))}
        </div>
      ) : lessons.length === 0 ? (
        <Empty className="flex-1 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarPlus />
            </EmptyMedia>
            <EmptyTitle>{t("lessons.emptyTodayTitle")}</EmptyTitle>
            <EmptyDescription>{t("lessons.emptyTodayBody")}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" onClick={() => setAdhocOpen(true)}>
              <Plus />
              {t("lessons.addAdhoc")}
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="flex flex-col gap-3">
          {lessons.map((lesson) => (
            <LessonCard key={lesson._id} lesson={lesson} />
          ))}
        </div>
      )}

      <AdhocDialog
        open={adhocOpen}
        onOpenChange={setAdhocOpen}
        defaultDate={today}
      />
    </div>
  );
}

function LessonCard({ lesson }: { lesson: TodayLesson }) {
  const complete =
    lesson.enrolledCount > 0 && lesson.markedCount >= lesson.enrolledCount;
  return (
    <Link
      href={`/teacher/lessons/${lesson._id}`}
      aria-label={t("lessons.openLesson", {
        subject: lesson.subjectName,
        class: lesson.className,
      })}
      className="flex min-h-21 items-center gap-3 rounded-2xl border bg-card p-4 outline-none transition-colors hover:border-primary/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <Badge variant="outline" className="shrink-0 tabular-nums">
        {t("lessons.periodBadge", { period: lesson.period })}
      </Badge>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-bold">{lesson.subjectName}</span>
          {lesson.source === "adhoc" ? (
            <Badge variant="secondary">{t("lessons.adhocBadge")}</Badge>
          ) : null}
        </div>
        <span className="truncate text-sm text-muted-foreground">
          {lesson.className}
          {lesson.title ? ` · ${lesson.title}` : ""}
        </span>
      </div>
      {lesson.markedCount > 0 ? (
        <span
          className={cn(
            "shrink-0 text-sm font-medium tabular-nums",
            complete ? "text-success" : "text-muted-foreground",
          )}
        >
          {t("lessons.attendanceProgress", {
            marked: lesson.markedCount,
            enrolled: lesson.enrolledCount,
          })}
        </span>
      ) : (
        <span className="shrink-0 rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground">
          {t("lessons.attendanceNotMarked")}
        </span>
      )}
    </Link>
  );
}
