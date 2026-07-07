"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  BookOpenCheck,
  CalendarCheck,
  Flame,
  Sparkles,
  Star,
  Target,
  Trophy,
  UserCheck,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { BarChart, PairedBars, Sparkline } from "@/components/charts";
import { formatNumber, t } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n";
import { useStudentSession } from "@/lib/student-session";
import { cn } from "@/lib/utils";

type MyProgress = FunctionReturnType<typeof api.gamification.myProgress>;
type BoardRows = FunctionReturnType<typeof api.gamification.classLeaderboard>;
type Analytics = FunctionReturnType<typeof api.portal.studentAnalytics>;

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

// ——— Fixed badge catalog (ids from convex/gamification.badgeIdsFor) ———

const BADGE_CATALOG: Array<{
  id: string;
  labelKey: MessageKey;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: "points_100", labelKey: "progress.badgePoints100", icon: Sparkles },
  { id: "points_500", labelKey: "progress.badgePoints500", icon: Star },
  { id: "points_1000", labelKey: "progress.badgePoints1000", icon: Trophy },
  { id: "streak_7", labelKey: "progress.badgeStreak7", icon: Flame },
  { id: "streak_30", labelKey: "progress.badgeStreak30", icon: CalendarCheck },
  { id: "perfect_exam", labelKey: "progress.badgePerfectExam", icon: Target },
  {
    id: "homework_10",
    labelKey: "progress.badgeHomework10",
    icon: BookOpenCheck,
  },
  {
    id: "attendance_30",
    labelKey: "progress.badgeAttendance30",
    icon: UserCheck,
  },
];

const WEEKDAY_KEYS: ReadonlyArray<MessageKey> = [
  "progress.weekday0",
  "progress.weekday1",
  "progress.weekday2",
  "progress.weekday3",
  "progress.weekday4",
];

// ——— Shared presentational pieces (module scope) ———

function CardEmptyText({ children }: { children: React.ReactNode }) {
  return (
    <p className="py-2 text-center text-sm text-muted-foreground">{children}</p>
  );
}

function CardSkeleton({ className }: { className?: string }) {
  return <Skeleton className={cn("h-40 rounded-2xl", className)} />;
}

// ——— Level card ———

function LevelCard({ data }: { data: MyProgress }) {
  const pctIntoLevel =
    data.nextLevelAt > 0
      ? Math.min(100, Math.round((data.pointsIntoLevel / data.nextLevelAt) * 100))
      : 0;
  return (
    <Card className="rounded-2xl">
      <CardContent className="flex flex-col gap-3">
        <span className="text-3xl font-black">
          {t("progress.levelN", { level: formatNumber(data.level) })}
        </span>
        <div
          role="progressbar"
          aria-label={t("progress.levelProgressLabel")}
          aria-valuemin={0}
          aria-valuemax={data.nextLevelAt}
          aria-valuenow={data.pointsIntoLevel}
          aria-valuetext={t("progress.levelProgressValue", {
            into: formatNumber(data.pointsIntoLevel),
            next: formatNumber(data.nextLevelAt),
          })}
          className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{ width: `${pctIntoLevel}%` }}
          />
        </div>
        <p className="text-sm text-muted-foreground">
          {t("progress.statsLine", {
            points: formatNumber(data.totalPoints),
            streak: formatNumber(data.streak),
          })}
        </p>
        {data.classRank !== null || data.schoolRank !== null ? (
          <div className="flex flex-wrap gap-2">
            {data.classRank !== null ? (
              <Badge variant="secondary" className="tabular-nums">
                {t("progress.classRankLine", {
                  rank: formatNumber(data.classRank),
                  size: formatNumber(data.classSize),
                })}
              </Badge>
            ) : null}
            {data.schoolRank !== null ? (
              <Badge variant="secondary" className="tabular-nums">
                {t("progress.schoolRankLine", {
                  rank: formatNumber(data.schoolRank),
                })}
              </Badge>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ——— Badges ———

function BadgesCard({ earned }: { earned: MyProgress["badges"] }) {
  const earnedSet = new Set(earned);
  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle>{t("progress.badgesTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="grid grid-cols-4 gap-2">
          {BADGE_CATALOG.map((badge) => {
            const isEarned = earnedSet.has(badge.id);
            return (
              <li
                key={badge.id}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-xl p-2 text-center",
                  isEarned
                    ? "bg-accent/20 text-accent-foreground"
                    : "opacity-40 grayscale",
                )}
              >
                <badge.icon
                  aria-hidden
                  className={cn(
                    "size-6",
                    !isEarned && "text-muted-foreground",
                  )}
                />
                <span className="text-[11px] leading-tight font-medium">
                  {t(badge.labelKey)}
                </span>
                <span className="sr-only">
                  {isEarned
                    ? t("progress.badgeEarnedSr")
                    : t("progress.badgeLockedSr")}
                </span>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

// ——— Leaderboards ———

function BoardList({ rows }: { rows: BoardRows | undefined }) {
  if (rows === undefined) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10 rounded-lg" />
        ))}
      </div>
    );
  }
  if (rows.length === 0) {
    return <CardEmptyText>{t("progress.boardEmpty")}</CardEmptyText>;
  }
  return (
    <ol className="flex flex-col">
      {rows.map((row) => (
        <li
          key={row.rank}
          className={cn(
            "flex items-center gap-3 border-s-2 border-s-transparent px-2 py-2",
            row.isMe && "rounded-lg border-s-primary bg-primary/5",
          )}
        >
          <span
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded-full text-sm font-black tabular-nums",
              row.rank <= 3
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground",
            )}
          >
            {formatNumber(row.rank)}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {row.name}
            {row.isMe ? (
              <span className="sr-only"> — {t("progress.youChip")}</span>
            ) : null}
          </span>
          <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
            {t("progress.pointsN", { n: formatNumber(row.totalPoints) })}
          </span>
          <Badge variant="secondary" className="shrink-0 tabular-nums">
            {t("progress.levelBadge", { level: formatNumber(row.level) })}
          </Badge>
        </li>
      ))}
    </ol>
  );
}

function LeaderboardCard({
  classRows,
  schoolRows,
}: {
  classRows: BoardRows | undefined;
  schoolRows: BoardRows | undefined;
}) {
  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle>{t("progress.leaderboardTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="class">
          <TabsList className="w-full">
            <TabsTrigger value="class">{t("progress.tabClass")}</TabsTrigger>
            <TabsTrigger value="school">{t("progress.tabSchool")}</TabsTrigger>
          </TabsList>
          <TabsContent value="class" className="mt-2">
            <BoardList rows={classRows} />
          </TabsContent>
          <TabsContent value="school" className="mt-2">
            <BoardList rows={schoolRows} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

// ——— Charts (data adapters around components/charts.tsx) ———

function CompareCard({ data }: { data: Analytics["subjectComparison"] }) {
  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle>{t("progress.compareTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <CardEmptyText>{t("progress.examsEmpty")}</CardEmptyText>
        ) : (
          <PairedBars
            // Integer labels read cleanly at paired-bar density on 390px;
            // the server's 1dp precision still drives relative bar heights.
            data={data.map((row) => ({
              label: row.subjectName,
              a: Math.round(row.myAvgPct),
              b: Math.round(row.classAvgPct),
            }))}
            aLabel={t("progress.legendMine")}
            bLabel={t("progress.legendClass")}
            max={100}
            unit="%"
          />
        )}
      </CardContent>
    </Card>
  );
}

function TrendCard({ data }: { data: Analytics["scoreTrend"] }) {
  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle>{t("progress.trendTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length < 2 ? (
          <CardEmptyText>{t("progress.examsEmpty")}</CardEmptyText>
        ) : (
          <Sparkline
            data={data.map((point) => ({
              label: point.label,
              value: point.pct,
            }))}
            max={100}
          />
        )}
      </CardContent>
    </Card>
  );
}

function WeekdayCard({ data }: { data: Analytics["attendanceByWeekday"] }) {
  const marked = data.map(
    (day) => day.present + day.late + day.absent,
  );
  const hasAny = marked.some((count) => count > 0);
  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle>{t("progress.weekdayTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        {!hasAny ? (
          <CardEmptyText>{t("progress.attendanceEmpty")}</CardEmptyText>
        ) : (
          <BarChart
            data={data.map((day, i) => ({
              label: t(WEEKDAY_KEYS[day.weekday] ?? WEEKDAY_KEYS[0]),
              value:
                marked[i] === 0
                  ? 0
                  : Math.round(((day.present + day.late) / marked[i]) * 100),
            }))}
            max={100}
            unit="%"
          />
        )}
      </CardContent>
    </Card>
  );
}

// ——— Weak topics (hidden when empty) ———

function WeakTopicsCard({ topics }: { topics: Analytics["weakTopics"] }) {
  if (topics.length === 0) return null;
  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle>{t("progress.weakTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="divide-y">
          {topics.map((topic) => (
            <div
              key={`${topic.subjectName}:${topic.topic}`}
              className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
            >
              <span className="min-w-0 truncate font-medium">
                {topic.topic}
                <span className="font-normal text-muted-foreground">
                  {" "}
                  — {topic.subjectName}
                </span>
              </span>
              <Badge variant="destructive" className="shrink-0 tabular-nums">
                {formatNumber(topic.pct)}%
              </Badge>
            </div>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">{t("progress.weakHint")}</p>
      </CardContent>
    </Card>
  );
}

// ——— Page ———

export default function PortalProgressPage() {
  const { sessionToken, ready } = useStudentSession();
  // Stable per mount: the analytics window doesn't shift while open.
  const [dates] = useState(() => ({
    from: thirtyDaysAgoKey(),
    to: todayKey(),
  }));
  const tokenArgs = ready && sessionToken ? { sessionToken } : "skip";
  const myProgress = useQuery(api.gamification.myProgress, tokenArgs);
  const classBoard = useQuery(api.gamification.classLeaderboard, tokenArgs);
  const schoolBoard = useQuery(api.gamification.schoolLeaderboard, tokenArgs);
  const analytics = useQuery(
    api.portal.studentAnalytics,
    ready && sessionToken ? { sessionToken, ...dates } : "skip",
  );

  return (
    <div className="flex flex-1 flex-col gap-6">
      <h1 className="heading-rule text-2xl font-black">
        {t("progress.title")}
      </h1>

      {myProgress === undefined ? (
        <>
          <CardSkeleton className="h-36" />
          <CardSkeleton />
        </>
      ) : (
        <>
          <LevelCard data={myProgress} />
          <BadgesCard earned={myProgress.badges} />
        </>
      )}

      <LeaderboardCard classRows={classBoard} schoolRows={schoolBoard} />

      {analytics === undefined ? (
        <>
          <CardSkeleton />
          <CardSkeleton className="h-32" />
          <CardSkeleton />
        </>
      ) : (
        <>
          <CompareCard data={analytics.subjectComparison} />
          <TrendCard data={analytics.scoreTrend} />
          <WeekdayCard data={analytics.attendanceByWeekday} />
          <WeakTopicsCard topics={analytics.weakTopics} />
        </>
      )}
    </div>
  );
}
