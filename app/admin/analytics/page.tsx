"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatNumber, t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

function pctText(pct: number): string {
  return t("analytics.pct", { pct });
}

function StatTile({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <Card size="sm" className="rounded-2xl">
      <CardContent className="flex flex-col gap-1">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="text-2xl font-black">{value}</span>
        {detail ? (
          <span className="text-xs text-muted-foreground">{detail}</span>
        ) : null}
      </CardContent>
    </Card>
  );
}

type LeaderboardRow = {
  rank: number;
  name: string;
  totalPoints: number;
  level: number;
};

function LeaderboardTable({
  rows,
}: {
  rows: Array<LeaderboardRow> | undefined;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-16">{t("analytics.colRank")}</TableHead>
            <TableHead>{t("analytics.colStudent")}</TableHead>
            <TableHead>{t("analytics.colPoints")}</TableHead>
            <TableHead>{t("analytics.colLevel")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows === undefined ? (
            Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={i}>
                {Array.from({ length: 4 }).map((_, j) => (
                  <TableCell key={j}>
                    <Skeleton className="h-4 w-full max-w-24" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={4}
                className="py-10 text-center text-muted-foreground"
              >
                {t("analytics.boardEmpty")}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={row.rank}>
                <TableCell className="text-muted-foreground tabular-nums">
                  {formatNumber(row.rank)}
                </TableCell>
                <TableCell className="font-medium">{row.name}</TableCell>
                <TableCell className="tabular-nums">
                  {formatNumber(row.totalPoints)}
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">
                    {t("analytics.levelBadge", { level: row.level })}
                  </Badge>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

export default function AdminAnalyticsPage() {
  const overview = useQuery(api.analytics.adminOverview, {});
  const classes = useQuery(api.lessons.listMyClasses, {});
  const [tab, setTab] = useState<"class" | "school">("class");
  const [classId, setClassId] = useState<Id<"classes"> | null>(null);

  // Only the visible board subscribes; the hidden tab's query stays skipped.
  const classBoard = useQuery(
    api.gamification.staffClassLeaderboard,
    tab === "class" && classId ? { classId } : "skip",
  );
  const schoolBoard = useQuery(
    api.gamification.staffSchoolLeaderboard,
    tab === "school" ? {} : "skip",
  );

  const classItems = useMemo(
    () =>
      (classes ?? []).map((c) => ({
        value: c.classId as string,
        label: `${c.gradeName} · ${c.className}`,
      })),
    [classes],
  );

  return (
    <div className="flex flex-1 flex-col gap-6">
      <h1 className="heading-rule text-2xl font-black">
        {t("analytics.title")}
      </h1>

      {/* Overview tiles */}
      {overview === undefined ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label={t("analytics.activeStudents")}
            value={formatNumber(overview.students)}
          />
          <StatTile
            label={t("analytics.attendanceToday")}
            value={pctText(overview.attendanceToday.rate)}
            detail={`${t("analytics.present")} ${formatNumber(
              overview.attendanceToday.present,
            )} · ${t("analytics.late")} ${formatNumber(
              overview.attendanceToday.late,
            )} · ${t("analytics.absent")} ${formatNumber(
              overview.attendanceToday.absent,
            )}`}
          />
          <StatTile
            label={t("analytics.examsThisWeek")}
            value={formatNumber(overview.examsThisWeek)}
          />
          <StatTile
            label={t("analytics.attendanceRate30d")}
            value={pctText(overview.avgAttendanceRate30d)}
          />
        </div>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-2">
        {/* Top-5 students */}
        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle>{t("analytics.topStudents")}</CardTitle>
          </CardHeader>
          <CardContent>
            {overview === undefined ? (
              <div className="flex flex-col gap-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-9 w-full" />
                ))}
              </div>
            ) : overview.topStudents.length === 0 ? (
              <p className="flex min-h-32 items-center justify-center text-center text-sm text-muted-foreground">
                {t("analytics.topStudentsEmpty")}
              </p>
            ) : (
              <ul className="divide-y">
                {overview.topStudents.map((row) => (
                  <li
                    key={row.rank}
                    className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
                  >
                    <span
                      className={cn(
                        "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums",
                        row.rank === 1
                          ? "bg-accent text-accent-foreground"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {formatNumber(row.rank)}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {row.name}
                    </span>
                    <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
                      {t("analytics.pointsN", {
                        n: formatNumber(row.totalPoints),
                      })}
                    </span>
                    <Badge variant="secondary" className="shrink-0">
                      {t("analytics.levelBadge", { level: row.level })}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Leaderboard: per-class or whole school */}
        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle>{t("analytics.leaderboard")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs
              value={tab}
              onValueChange={(value) => setTab(value as "class" | "school")}
            >
              <TabsList>
                <TabsTrigger value="class">
                  {t("analytics.tabByClass")}
                </TabsTrigger>
                <TabsTrigger value="school">
                  {t("analytics.tabSchool")}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="class" className="flex flex-col gap-3">
                <div className="flex w-full max-w-60 flex-col gap-1.5">
                  <Label id="board-class-label">
                    {t("analytics.classLabel")}
                  </Label>
                  <Select
                    items={classItems}
                    value={classId}
                    onValueChange={(value) =>
                      setClassId((value as Id<"classes"> | null) ?? null)
                    }
                    disabled={classes === undefined}
                  >
                    <SelectTrigger
                      className="w-full"
                      aria-labelledby="board-class-label"
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
                  <p className="flex min-h-24 items-center justify-center text-center text-sm text-muted-foreground">
                    {t("analytics.pickClassForBoard")}
                  </p>
                ) : (
                  <LeaderboardTable rows={classBoard} />
                )}
              </TabsContent>
              <TabsContent value="school">
                <LeaderboardTable rows={schoolBoard} />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
