"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { TrendingUp } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { BarChart, Sparkline } from "@/components/charts";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, formatNumber, t } from "@/lib/i18n";

function pctText(pct: number): string {
  return t("analytics.pct", { pct });
}

/** "YYYY-MM-DD" → local-midnight ms (avoids the UTC shift of Date.parse). */
function dayMs(date: string): number {
  return new Date(`${date}T00:00:00`).getTime();
}

function EmptyNote({ text }: { text: string }) {
  return (
    <p className="flex min-h-32 items-center justify-center text-center text-sm text-muted-foreground">
      {text}
    </p>
  );
}

/** Weak-topic tone: destructive under 50٪, saffron 50–70٪, quiet above. */
function PctBadge({ pct }: { pct: number }) {
  if (pct < 50) {
    return (
      <Badge variant="destructive" className="shrink-0 tabular-nums">
        {pctText(pct)}
      </Badge>
    );
  }
  if (pct <= 70) {
    return (
      <Badge
        variant="outline"
        className="shrink-0 border-transparent bg-accent text-accent-foreground tabular-nums"
      >
        {pctText(pct)}
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="shrink-0 tabular-nums">
      {pctText(pct)}
    </Badge>
  );
}

export default function TeacherAnalyticsPage() {
  const classes = useQuery(api.lessons.listMyClasses, {});
  const [classId, setClassId] = useState<Id<"classes"> | null>(null);
  const [subjectId, setSubjectId] = useState<Id<"subjects"> | null>(null);

  const classItems = useMemo(
    () =>
      (classes ?? []).map((c) => ({
        value: c.classId as string,
        label: `${c.gradeName} · ${c.className}`,
      })),
    [classes],
  );

  const selectedClass = classes?.find((c) => c.classId === classId);
  const subjectItems = useMemo(
    () =>
      (selectedClass?.subjects ?? []).map((s) => ({
        value: s.subjectId as string,
        label: s.name,
      })),
    [selectedClass],
  );
  // Derived during render: the picked subject when it belongs to the selected
  // class, else the class's first subject (so the report shows immediately).
  const effectiveSubjectId =
    subjectId !== null && subjectItems.some((item) => item.value === subjectId)
      ? subjectId
      : ((subjectItems[0]?.value as Id<"subjects"> | undefined) ?? null);

  const analytics = useQuery(
    api.analytics.teacherClassAnalytics,
    classId ? { classId } : "skip",
  );
  const weak = useQuery(
    api.analytics.weakTopics,
    classId && effectiveSubjectId
      ? { classId, subjectId: effectiveSubjectId }
      : "skip",
  );

  // Exam averages as % of each exam's total marks; null until a final score.
  const examBars =
    analytics?.examSeries.map((exam) => ({
      label: exam.title,
      value:
        exam.avg !== null && exam.maxScore > 0
          ? Math.round((exam.avg / exam.maxScore) * 100)
          : null,
    })) ?? [];
  const latestAttendance = analytics?.attendanceTrend.at(-1);

  return (
    <div className="flex flex-1 flex-col gap-6">
      <h1 className="heading-rule text-2xl font-black">
        {t("analytics.title")}
      </h1>

      <div className="flex w-full max-w-xs flex-col gap-1.5">
        <Label id="analytics-class-label">{t("analytics.classLabel")}</Label>
        <Select
          items={classItems}
          value={classId}
          onValueChange={(value) => {
            setClassId((value as Id<"classes"> | null) ?? null);
            setSubjectId(null);
          }}
          disabled={classes === undefined}
        >
          <SelectTrigger
            className="w-full"
            aria-labelledby="analytics-class-label"
          >
            <SelectValue placeholder={t("analytics.selectClass")} />
          </SelectTrigger>
          <SelectContent>
            {classItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!classId ? (
        <Empty className="flex-1 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <TrendingUp />
            </EmptyMedia>
            <EmptyTitle>{t("analytics.pickClassTitle")}</EmptyTitle>
            <EmptyDescription>{t("analytics.pickClassBody")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-2">
          {/* Exam averages */}
          <Card className="rounded-2xl">
            <CardHeader>
              <CardTitle>{t("analytics.examAvgTitle")}</CardTitle>
            </CardHeader>
            <CardContent>
              {analytics === undefined ? (
                <Skeleton className="h-40 w-full" />
              ) : examBars.length === 0 ? (
                <EmptyNote text={t("analytics.examAvgEmpty")} />
              ) : (
                <BarChart data={examBars} max={100} unit="٪" />
              )}
            </CardContent>
          </Card>

          {/* Attendance-rate trend (30 days) */}
          <Card className="rounded-2xl">
            <CardHeader>
              <CardTitle>{t("analytics.attendanceTrendTitle")}</CardTitle>
            </CardHeader>
            <CardContent>
              {analytics === undefined ? (
                <Skeleton className="h-40 w-full" />
              ) : analytics.attendanceTrend.length === 0 ? (
                <EmptyNote text={t("analytics.attendanceTrendEmpty")} />
              ) : (
                <div className="flex flex-col gap-3">
                  {latestAttendance ? (
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="text-3xl font-black">
                        {pctText(latestAttendance.rate)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {t("analytics.latestRate")} ·{" "}
                        {formatDate(dayMs(latestAttendance.date))}
                      </span>
                    </div>
                  ) : null}
                  <Sparkline
                    data={analytics.attendanceTrend.map((day) => ({
                      label: formatDate(dayMs(day.date)),
                      value: day.rate,
                    }))}
                    max={100}
                  />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Per-subject averages */}
          <Card className="rounded-2xl">
            <CardHeader>
              <CardTitle>{t("analytics.subjectAvgTitle")}</CardTitle>
            </CardHeader>
            <CardContent>
              {analytics === undefined ? (
                <Skeleton className="h-40 w-full" />
              ) : analytics.subjectAverages.length === 0 ? (
                <EmptyNote text={t("analytics.subjectAvgEmpty")} />
              ) : (
                <BarChart
                  data={analytics.subjectAverages.map((subject) => ({
                    label: subject.subjectName,
                    value: subject.avgPct,
                  }))}
                  max={100}
                  unit="٪"
                />
              )}
            </CardContent>
          </Card>

          {/* Weak topics */}
          <Card className="rounded-2xl">
            <CardHeader>
              <CardTitle>{t("analytics.weakTopicsTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {subjectItems.length === 0 ? (
                <EmptyNote text={t("analytics.noSubjects")} />
              ) : (
                <>
                  <div className="flex w-full max-w-60 flex-col gap-1.5">
                    <Label id="analytics-subject-label">
                      {t("analytics.subjectLabel")}
                    </Label>
                    <Select
                      items={subjectItems}
                      value={effectiveSubjectId}
                      onValueChange={(value) =>
                        setSubjectId((value as Id<"subjects"> | null) ?? null)
                      }
                    >
                      <SelectTrigger
                        className="w-full"
                        aria-labelledby="analytics-subject-label"
                      >
                        <SelectValue
                          placeholder={t("analytics.selectSubject")}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {subjectItems.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {weak === undefined ? (
                    <div className="flex flex-col gap-2">
                      {Array.from({ length: 3 }).map((_, i) => (
                        <Skeleton key={i} className="h-9 w-full" />
                      ))}
                    </div>
                  ) : weak.topics.length === 0 ? (
                    <EmptyNote text={t("analytics.weakTopicsEmpty")} />
                  ) : (
                    <>
                      <ul className="divide-y">
                        {weak.topics.map((topic) => (
                          <li
                            key={topic.topic}
                            className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
                          >
                            <span className="min-w-0 flex-1 truncate font-medium">
                              {topic.topic}
                            </span>
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {t("analytics.answersCount", {
                                total: formatNumber(topic.total),
                              })}
                            </span>
                            <PctBadge pct={topic.pct} />
                          </li>
                        ))}
                      </ul>
                      {weak.recommendations.length > 0 ? (
                        <div className="rounded-xl bg-accent p-3">
                          <p className="text-sm font-bold text-accent-foreground">
                            {t("analytics.recommendPrefix")}
                          </p>
                          <ul className="mt-1 flex flex-col gap-1 text-sm text-accent-foreground">
                            {weak.recommendations.map((rec) => (
                              <li key={rec.topic}>
                                {t("analytics.recommendItem", {
                                  topic: rec.topic,
                                  subject: rec.subjectName,
                                })}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
